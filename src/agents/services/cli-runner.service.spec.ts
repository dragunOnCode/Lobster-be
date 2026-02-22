import { CliExitError, CliNotFoundError, CliRunnerService, TimeoutError } from './cli-runner.service';

describe('CliRunnerService', () => {
  const service = new CliRunnerService();

  it('应返回 stdout/stderr 且 exitCode=0', async () => {
    const result = await service.run({
      command: process.execPath,
      args: ['-e', 'console.log("ok"); console.error("warn")'],
      timeout: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ok');
    expect(result.stderr).toContain('warn');
  });

  it('超时应抛 TimeoutError', async () => {
    await expect(
      service.run({
        command: process.execPath,
        args: ['-e', 'setTimeout(() => console.log("done"), 2000)'],
        timeout: 100,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('非零退出码应抛 CliExitError', async () => {
    await expect(
      service.run({
        command: process.execPath,
        args: ['-e', 'process.stderr.write("boom"); process.exit(2)'],
        timeout: 5000,
      }),
    ).rejects.toBeInstanceOf(CliExitError);
  });

  it('命令不存在应抛 CliNotFoundError', async () => {
    await expect(
      service.run({
        command: '__non_existing_binary__',
        args: [],
        timeout: 1000,
      }),
    ).rejects.toBeInstanceOf(CliNotFoundError);
  });
});
