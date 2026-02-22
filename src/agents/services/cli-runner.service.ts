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

@Injectable()
export class CliRunnerService {
  async run(opts: CliRunOptions): Promise<CliRunResult> {
    const timeout = opts.timeout ?? 60000;
    const command = `${opts.command} ${opts.args.join(' ')}`.trim();

    return new Promise<CliRunResult>((resolve, reject) => {
      const execOptions: ExecFileOptions = {
        cwd: opts.cwd,
        timeout,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      };

      const child = execFile(opts.command, opts.args, execOptions, (error, stdout, stderr) => {
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

        const err = error as NodeJS.ErrnoException & { code?: string | number; killed?: boolean };
        if (err.code === 'ENOENT') {
          reject(new CliNotFoundError(opts.command));
          return;
        }
        if (err.killed) {
          reject(new TimeoutError(command, timeout));
          return;
        }

        const exitCode = typeof err.code === 'number' ? err.code : 1;
        reject(new CliExitError(command, exitCode, normalizedStderr));
      });

      if (opts.input && child.stdin) {
        child.stdin.write(opts.input);
        child.stdin.end();
      }
    });
  }
}
