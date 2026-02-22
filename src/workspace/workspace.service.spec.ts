import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { WorkspaceService } from './workspace.service';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'lobster-workspace-'));
    const configService = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        if (key === 'WORKSPACE_ROOT') {
          return workspaceRoot;
        }
        throw new Error(`Unexpected key: ${key}`);
      }),
    } as unknown as ConfigService;

    service = new WorkspaceService(configService);
    await service.onModuleInit();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('应初始化会话目录并记录创建事件', async () => {
    await service.initializeSession('session-1');
    const transcript = await service.readTranscript('session-1');

    expect(transcript.length).toBe(1);
    expect(transcript[0]).toEqual(
      expect.objectContaining({
        type: 'session_created',
        sessionId: 'session-1',
      }),
    );
  });

  it('应保存代码文件并记录 file_created 事件', async () => {
    await service.initializeSession('session-2');
    await service.saveCodeFile('session-2', 'src/index.ts', 'const a = 1;\n', 'claude-001');
    const transcript = await service.readTranscript('session-2');

    expect(transcript.length).toBe(2);
    expect(transcript[1]).toEqual(
      expect.objectContaining({
        type: 'file_created',
        path: 'src/index.ts',
        author: 'claude-001',
        language: 'typescript',
      }),
    );
  });
});
