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

  it('initializes the session workspace and records session creation', async () => {
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

  it('records file_created when saving code files', async () => {
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

  it('replaceTranscript overwrites transcript contents', async () => {
    await service.initializeSession('session-3');
    await service.appendTranscript('session-3', {
      type: 'message_saved',
      timestamp: '2026-03-02T00:00:00.000Z',
      role: 'user',
    });

    await service.replaceTranscript('session-3', [
      {
        type: 'session_created',
        sessionId: 'session-3',
        timestamp: '2026-03-01T23:59:00.000Z',
      },
      {
        type: 'message_saved',
        timestamp: '2026-03-02T00:00:00.000Z',
        role: 'assistant',
      },
    ]);

    await expect(service.readTranscript('session-3')).resolves.toEqual([
      expect.objectContaining({ type: 'session_created', sessionId: 'session-3' }),
      expect.objectContaining({ type: 'message_saved', role: 'assistant' }),
    ]);
  });
});
