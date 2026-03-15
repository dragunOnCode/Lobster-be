import { spawn } from 'child_process';
import { Injectable } from '@nestjs/common';

export class TimeoutError extends Error {
  constructor(
    public readonly command: string,
    public readonly timeoutMs: number,
    public readonly stdout: string = '',
    public readonly stderr: string = '',
  ) {
    super(`CLI timed out after ${timeoutMs}ms: ${command}`);
    this.name = 'TimeoutError';
  }
}

export class CliExitError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`CLI exited with code ${exitCode}: ${command}`);
    this.name = 'CliExitError';
  }
}

export class CliNotFoundError extends Error {
  constructor(public readonly command: string) {
    super(`CLI command not found: ${command}`);
    this.name = 'CliNotFoundError';
  }
}

export interface CliRunOptions {
  command: string;
  args: string[];
  timeout?: number;
  cwd?: string;
  input?: string;
  /**
   * 针对 Claude stream-json 的兜底优化：
   * 当 stdout 中出现 {"type":"result", ...} 这类“最终事件”时，
   * 主动结束子进程，避免模型已返回但进程长期不退出导致超时。
   */
  stopOnClaudeResultEvent?: boolean;
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliStreamEvent {
  stream: 'stdout' | 'stderr';
  chunk: string;
}

interface RawExecError extends Error {
  code?: string | number;
  killed?: boolean;
  stderr: string;
  stdout: string;
}

@Injectable()
export class CliRunnerService {
  async run(opts: CliRunOptions): Promise<CliRunResult> {
    const timeout = opts.timeout ?? 60000;
    const command = `${opts.command} ${opts.args.join(' ')}`.trim();
    const execOptions = {
      cwd: opts.cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    };

    try {
      return await this.executeRaw(opts.command, opts.args, execOptions, opts.input, opts.stopOnClaudeResultEvent);
    } catch (error) {
      const rawError = error as RawExecError;
      if (process.platform !== 'win32' || rawError.code !== 'ENOENT') {
        throw this.toCliError(rawError, command, timeout, opts.command);
      }

      const resolved = await this.resolveWindowsCommand(opts.command);
      if (!resolved) {
        throw new CliNotFoundError(opts.command);
      }

      const isCmdScript = /\.(cmd|bat)$/i.test(resolved);
      try {
        if (isCmdScript) {
          return await this.executeRaw(
            'cmd.exe',
            ['/d', '/c', resolved, ...opts.args],
            execOptions,
            opts.input,
            opts.stopOnClaudeResultEvent,
          );
        }
        return await this.executeRaw(resolved, opts.args, execOptions, opts.input, opts.stopOnClaudeResultEvent);
      } catch (retryError) {
        throw this.toCliError(retryError as RawExecError, command, timeout, opts.command);
      }
    }
  }

  async *stream(opts: CliRunOptions): AsyncGenerator<CliStreamEvent, CliRunResult> {
    const timeout = opts.timeout ?? 60000;
    const command = `${opts.command} ${opts.args.join(' ')}`.trim();
    const execOptions = {
      cwd: opts.cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    };

    try {
      return yield* this.executeStreamingRaw(
        opts.command,
        opts.args,
        execOptions,
        opts.input,
        opts.stopOnClaudeResultEvent,
      );
    } catch (error) {
      const rawError = error as RawExecError;
      if (process.platform !== 'win32' || rawError.code !== 'ENOENT') {
        throw this.toCliError(rawError, command, timeout, opts.command);
      }

      const resolved = await this.resolveWindowsCommand(opts.command);
      if (!resolved) {
        throw new CliNotFoundError(opts.command);
      }

      const isCmdScript = /\.(cmd|bat)$/i.test(resolved);
      try {
        if (isCmdScript) {
          return yield* this.executeStreamingRaw(
            'cmd.exe',
            ['/d', '/c', resolved, ...opts.args],
            execOptions,
            opts.input,
            opts.stopOnClaudeResultEvent,
          );
        }
        return yield* this.executeStreamingRaw(
          resolved,
          opts.args,
          execOptions,
          opts.input,
          opts.stopOnClaudeResultEvent,
        );
      } catch (retryError) {
        throw this.toCliError(retryError as RawExecError, command, timeout, opts.command);
      }
    }
  }

  private async executeRaw(
    command: string,
    args: string[],
    execOptions: { cwd?: string; timeout: number; windowsHide: boolean; maxBuffer: number },
    input?: string,
    stopOnClaudeResultEvent = false,
  ): Promise<CliRunResult> {
    return new Promise<CliRunResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: execOptions.cwd,
        windowsHide: execOptions.windowsHide,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';
      let stdoutRemainder = '';
      let settled = false;
      let exitedByTimeout = false;
      let earlyStopTriggered = false;
      let forceKillTimer: NodeJS.Timeout | undefined;
      let timeoutTimer: NodeJS.Timeout | undefined;

      const finishResolve = (result: CliRunResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        resolve(result);
      };

      const finishReject = (error: RawExecError): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        reject(error);
      };

      const pushStdoutChunk = (chunk: Buffer | string): void => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString();
        stdout += text;
        if (stdout.length > execOptions.maxBuffer) {
          child.kill();
          finishReject({
            name: 'Error',
            message: `stdout maxBuffer exceeded: ${execOptions.maxBuffer}`,
            stderr,
            stdout,
            code: 'MAXBUFFER',
          } as RawExecError);
          return;
        }
        if (!stopOnClaudeResultEvent || earlyStopTriggered) {
          return;
        }

        // 问题定位思路：
        // 1) Claude 在 stream-json 下可能已输出最终 result 事件；
        // 2) 但进程仍因后台收尾（插件/遥测/会话写盘）迟迟不退出；
        // 3) 因此这里按“行”探测 {"type":"result"}，命中后主动结束进程。
        stdoutRemainder += text;
        const lines = stdoutRemainder.split(/\r?\n/);
        stdoutRemainder = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) {
            continue;
          }
          if (!this.isClaudeResultEventLine(line)) {
            continue;
          }
          earlyStopTriggered = true;
          child.kill();
          forceKillTimer = setTimeout(() => {
            if (!settled) {
              child.kill('SIGKILL');
            }
          }, 300);
          break;
        }
      };

      child.stdout?.on('data', (chunk) => pushStdoutChunk(chunk));
      child.stderr?.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString();
        stderr += text;
        if (stderr.length > execOptions.maxBuffer) {
          child.kill();
          finishReject({
            name: 'Error',
            message: `stderr maxBuffer exceeded: ${execOptions.maxBuffer}`,
            stderr,
            stdout,
            code: 'MAXBUFFER',
          } as RawExecError);
        }
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        finishReject({
          ...(err as Error),
          stderr,
          stdout,
          code: err.code,
        } as RawExecError);
      });

      child.on('close', (code) => {
        if (exitedByTimeout) {
          finishReject({
            name: 'TimeoutError',
            message: `CLI timed out after ${execOptions.timeout}ms: ${command}`,
            stderr,
            stdout,
            code: code ?? 1,
            killed: true,
          } as RawExecError);
          return;
        }
        if (earlyStopTriggered) {
          finishResolve({
            stdout,
            stderr,
            exitCode: 0,
          });
          return;
        }
        if ((code ?? 0) === 0) {
          finishResolve({
            stdout,
            stderr,
            exitCode: 0,
          });
          return;
        }
        finishReject({
          name: 'CliExitError',
          message: `CLI exited with code ${code ?? 1}: ${command}`,
          stderr,
          stdout,
          code: code ?? 1,
        } as RawExecError);
      });

      timeoutTimer = setTimeout(() => {
        if (settled) {
          return;
        }
        exitedByTimeout = true;
        child.kill();
        forceKillTimer = setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
          }
        }, 500);
      }, execOptions.timeout);

      if (input && child.stdin) {
        child.stdin.write(input);
      }
      child.stdin?.end();
    });
  }

  private async *executeStreamingRaw(
    command: string,
    args: string[],
    execOptions: { cwd?: string; timeout: number; windowsHide: boolean; maxBuffer: number },
    input?: string,
    stopOnClaudeResultEvent = false,
  ): AsyncGenerator<CliStreamEvent, CliRunResult> {
    const child = spawn(command, args, {
      cwd: execOptions.cwd,
      windowsHide: execOptions.windowsHide,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';
    let stdoutRemainder = '';
    let settled = false;
    let exitedByTimeout = false;
    let earlyStopTriggered = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    const queue: Array<
      | { kind: 'event'; value: CliStreamEvent }
      | { kind: 'resolve'; value: CliRunResult }
      | { kind: 'reject'; value: RawExecError }
    > = [];
    let wake: (() => void) | undefined;

    const notify = (): void => {
      wake?.();
      wake = undefined;
    };

    const push = (
      item:
        | { kind: 'event'; value: CliStreamEvent }
        | { kind: 'resolve'; value: CliRunResult }
        | { kind: 'reject'; value: RawExecError },
    ): void => {
      queue.push(item);
      notify();
    };

    const finishResolve = (result: CliRunResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      push({ kind: 'resolve', value: result });
    };

    const finishReject = (error: RawExecError): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      push({ kind: 'reject', value: error });
    };

    const pushStdoutChunk = (chunk: Buffer | string): void => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      stdout += text;
      if (stdout.length > execOptions.maxBuffer) {
        child.kill();
        finishReject({
          name: 'Error',
          message: `stdout maxBuffer exceeded: ${execOptions.maxBuffer}`,
          stderr,
          stdout,
          code: 'MAXBUFFER',
        } as RawExecError);
        return;
      }

      push({
        kind: 'event',
        value: {
          stream: 'stdout',
          chunk: text,
        },
      });

      if (!stopOnClaudeResultEvent || earlyStopTriggered) {
        return;
      }

      stdoutRemainder += text;
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !this.isClaudeResultEventLine(line)) {
          continue;
        }
        earlyStopTriggered = true;
        child.kill();
        forceKillTimer = setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
          }
        }, 300);
        break;
      }
    };

    child.stdout?.on('data', (chunk) => pushStdoutChunk(chunk));
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      stderr += text;
      if (stderr.length > execOptions.maxBuffer) {
        child.kill();
        finishReject({
          name: 'Error',
          message: `stderr maxBuffer exceeded: ${execOptions.maxBuffer}`,
          stderr,
          stdout,
          code: 'MAXBUFFER',
        } as RawExecError);
        return;
      }

      push({
        kind: 'event',
        value: {
          stream: 'stderr',
          chunk: text,
        },
      });
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      finishReject({
        ...(err as Error),
        stderr,
        stdout,
        code: err.code,
      } as RawExecError);
    });

    child.on('close', (code) => {
      if (exitedByTimeout) {
        finishReject({
          name: 'TimeoutError',
          message: `CLI timed out after ${execOptions.timeout}ms: ${command}`,
          stderr,
          stdout,
          code: code ?? 1,
          killed: true,
        } as RawExecError);
        return;
      }
      if (earlyStopTriggered || (code ?? 0) === 0) {
        finishResolve({
          stdout,
          stderr,
          exitCode: 0,
        });
        return;
      }
      finishReject({
        name: 'CliExitError',
        message: `CLI exited with code ${code ?? 1}: ${command}`,
        stderr,
        stdout,
        code: code ?? 1,
      } as RawExecError);
    });

    timeoutTimer = setTimeout(() => {
      if (settled) {
        return;
      }
      exitedByTimeout = true;
      child.kill();
      forceKillTimer = setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 500);
    }, execOptions.timeout);

    if (input && child.stdin) {
      child.stdin.write(input);
    }
    child.stdin?.end();

    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      const item = queue.shift();
      if (!item) {
        continue;
      }

      if (item.kind === 'event') {
        yield item.value;
        continue;
      }
      if (item.kind === 'reject') {
        throw item.value;
      }
      return item.value;
    }
  }

  private isClaudeResultEventLine(line: string): boolean {
    try {
      const json = JSON.parse(line) as Record<string, unknown>;
      return this.pickString(json, ['type']) === 'result';
    } catch {
      return false;
    }
  }

  private toCliError(error: RawExecError, command: string, timeout: number, originalCommand: string): Error {
    if (!error || typeof error !== 'object') {
      return new Error(String(error));
    }

    const rawError = error as Partial<RawExecError> & { name?: string; message?: string };
    const stderr = typeof rawError.stderr === 'string' ? rawError.stderr : '';
    const stdout = typeof rawError.stdout === 'string' ? rawError.stdout : '';
    if (rawError.code === 'ENOENT' || this.isCommandNotFound(stderr, originalCommand)) {
      return new CliNotFoundError(originalCommand);
    }
    if (rawError.killed) {
      return new TimeoutError(command, timeout, stdout, stderr);
    }
    if (rawError.name === 'ReferenceError' || rawError.name === 'TypeError') {
      return rawError instanceof Error ? rawError : new Error(rawError.message ?? String(error));
    }
    const exitCode = typeof rawError.code === 'number' ? rawError.code : 1;
    return new CliExitError(command, exitCode, stderr);
  }

  private isCommandNotFound(stderr: string, command: string): boolean {
    if (!stderr) {
      return false;
    }
    const lower = stderr.toLowerCase();
    const commandLower = command.toLowerCase();
    return (
      lower.includes('is not recognized as an internal or external command') ||
      lower.includes('not found') ||
      lower.includes(`'${commandLower}'`)
    );
  }

  private async resolveWindowsCommand(command: string): Promise<string | undefined> {
    const lookup = await this.executeRaw(
      'where.exe',
      [command],
      {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 5000,
      },
      undefined,
      false,
    ).catch(() => null);

    if (!lookup) {
      return undefined;
    }

    const candidates = lookup.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (candidates.length === 0) {
      return undefined;
    }

    const cmdCandidate = candidates.find((item) => /\.(cmd|bat)$/i.test(item));
    return cmdCandidate ?? candidates[0];
  }

  private pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    return undefined;
  }

}
