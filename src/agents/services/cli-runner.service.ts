import { execFile, ExecFileOptions } from 'child_process';
import { Injectable } from '@nestjs/common';

export class TimeoutError extends Error {
  constructor(
    public readonly command: string,
    public readonly timeoutMs: number,
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
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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
    const execOptions: ExecFileOptions = {
      cwd: opts.cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    };

    try {
      return await this.executeRaw(opts.command, opts.args, execOptions, opts.input);
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
          return await this.executeRaw('cmd.exe', ['/d', '/c', resolved, ...opts.args], execOptions, opts.input);
        }
        return await this.executeRaw(resolved, opts.args, execOptions, opts.input);
      } catch (retryError) {
        throw this.toCliError(retryError as RawExecError, command, timeout, opts.command);
      }
    }
  }

  private async executeRaw(
    command: string,
    args: string[],
    execOptions: ExecFileOptions,
    input?: string,
  ): Promise<CliRunResult> {
    return new Promise<CliRunResult>((resolve, reject) => {
      const child = execFile(command, args, execOptions, (error, stdout, stderr) => {
        const normalizedStdout = stdout?.toString() ?? '';
        const normalizedStderr = stderr?.toString() ?? '';

        if (!error) {
          resolve({
            stdout: normalizedStdout,
            stderr: normalizedStderr,
            exitCode: 0,
          });
          return;
        }

        const rawError = error as RawExecError;
        rawError.stdout = normalizedStdout;
        rawError.stderr = normalizedStderr;
        reject(rawError);
      });

      if (input && child.stdin) {
        child.stdin.write(input);
        child.stdin.end();
      }
    });
  }

  private toCliError(error: RawExecError, command: string, timeout: number, originalCommand: string): Error {
    if (error.code === 'ENOENT' || this.isCommandNotFound(error.stderr, originalCommand)) {
      return new CliNotFoundError(originalCommand);
    }
    if (error.killed) {
      return new TimeoutError(command, timeout);
    }
    const exitCode = typeof error.code === 'number' ? error.code : 1;
    return new CliExitError(command, exitCode, error.stderr ?? '');
  }

  private isCommandNotFound(stderr: string, command: string): boolean {
    const lower = stderr.toLowerCase();
    const commandLower = command.toLowerCase();
    return (
      lower.includes('is not recognized as an internal or external command') ||
      lower.includes('not found') ||
      lower.includes(`'${commandLower}'`)
    );
  }

  private async resolveWindowsCommand(command: string): Promise<string | undefined> {
    const lookup = await this.executeRaw('where.exe', [command], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }).catch(() => null);

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

}
