import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import { CliExitError, CliNotFoundError, CliRunnerService, TimeoutError } from './cli-runner.service';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

type MockChildProcess = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  kill: jest.Mock;
};

function createMockChild(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = jest.fn();
  return child;
}

describe('CliRunnerService', () => {
  const service = new CliRunnerService();
  const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('returns stdout/stderr with exitCode=0', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const pending = service.run({
      command: 'demo-cli',
      args: ['--ok'],
      timeout: 5000,
    });

    child.stdout.write('ok\n');
    child.stderr.write('warn\n');
    child.emit('close', 0);

    await expect(pending).resolves.toEqual({
      stdout: 'ok\n',
      stderr: 'warn\n',
      exitCode: 0,
    });
  });

  it('throws TimeoutError on timeout', async () => {
    const child = createMockChild();
    child.kill.mockImplementation(() => {
      setTimeout(() => child.emit('close', 1), 0);
      return true;
    });
    mockSpawn.mockReturnValue(child as never);

    await expect(
      service.run({
        command: 'demo-cli',
        args: ['--slow'],
        timeout: 10,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('throws CliExitError on non-zero exit code', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const pending = service.run({
      command: 'demo-cli',
      args: ['--fail'],
      timeout: 5000,
    });

    child.stderr.write('boom');
    child.emit('close', 2);

    await expect(pending).rejects.toBeInstanceOf(CliExitError);
  });

  it('throws CliNotFoundError when command does not exist', async () => {
    const child = createMockChild();
    const whereChild = createMockChild();
    mockSpawn.mockReturnValueOnce(child as never).mockReturnValueOnce(whereChild as never);

    const pending = service.run({
      command: '__non_existing_binary__',
      args: [],
      timeout: 1000,
    });

    setTimeout(() => {
      child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
      setTimeout(() => whereChild.emit('close', 1), 0);
    }, 0);

    await expect(pending).rejects.toBeInstanceOf(CliNotFoundError);
  });

  it('streams stdout chunks in order', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const received: string[] = [];
    const iterator = service.stream({
      command: 'demo-cli',
      args: ['--stream'],
      timeout: 5000,
    });

    const consuming = (async () => {
      for await (const event of iterator) {
        if (event.stream === 'stdout') {
          received.push(event.chunk);
        }
      }
    })();

    child.stdout.write('a\n');
    child.stdout.write('b\n');
    child.emit('close', 0);

    await consuming;
    expect(received.join('')).toBe('a\nb\n');
  });
});
