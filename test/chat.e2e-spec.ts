import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { io, Socket } from 'socket.io-client';
import { Repository } from 'typeorm';
import { ClaudeAdapter } from '../src/agents/adapters';
import { AppModule } from '../src/app.module';
import { MessageEntity } from '../src/database/entities';

describe('Chat E2E', () => {
  let app: INestApplication;
  let socket: Socket;
  let messageRepo: Repository<MessageEntity>;
  let sessionId: string;
  let userId: string;
  let port: number;

  beforeAll(async () => {
    jest.setTimeout(30000);
    process.env.DB_SYNCHRONIZE = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClaudeAdapter)
      .useValue({
        id: 'claude-001',
        name: 'Claude',
        generate: jest.fn().mockResolvedValue({ content: 'Hello! 我是Claude，已收到你的消息。' }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const address = app.getHttpServer().address();
    port = typeof address === 'string' ? 3000 : address.port;
    messageRepo = app.get<Repository<MessageEntity>>(getRepositoryToken(MessageEntity));
  });

  afterAll(async () => {
    if (socket && socket.connected) {
      socket.disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  it('发送消息后应收到Agent响应并落库/记录transcript', async () => {
    jest.setTimeout(20000);
    sessionId = crypto.randomUUID();
    userId = `u-${Date.now()}`;

    const assistantMessage = await new Promise<MessageEntity>((resolve, reject) => {
      socket = io(`http://localhost:${port}/chat`, {
        transports: ['websocket'],
        query: {
          sessionId,
          userId,
        },
      });

      socket.on('connect_error', (error) => reject(error));
      socket.on('message:received', (message: MessageEntity) => {
        if (message.role === 'assistant') {
          resolve(message);
        }
      });

      socket.on('connect', () => {
        socket.emit('message:send', { content: 'Hello Claude', sessionId });
      });
    });

    expect(assistantMessage).toEqual(
      expect.objectContaining({
        role: 'assistant',
        agentId: 'claude-001',
        sessionId,
      }),
    );

    const dbMessages = await messageRepo.find({ where: { sessionId } });
    expect(dbMessages.length).toBeGreaterThanOrEqual(2);

    const workspaceRoot = process.env.WORKSPACE_ROOT ?? './workspace/sessions';
    const transcriptPath = path.join(workspaceRoot, sessionId, 'transcripts.jsonl');
    const transcriptContent = await fs.readFile(transcriptPath, 'utf-8');
    expect(transcriptContent).toContain('"type":"message_saved"');
  });
});
