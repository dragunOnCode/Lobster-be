import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CliExitError, CliNotFoundError, CliRunnerService } from '../services/cli-runner.service';
import { AgentContext, AgentResponse, AgentStatus, DecisionResult, ILLMAdapter, Message } from '../interfaces';
import { SharedMemoryService } from '../../memory/services/shared-memory.service';

@Injectable()
export class GeminiAdapter implements ILLMAdapter {
  readonly id = 'gemini-001';
  readonly name = 'Gemini';
  readonly model = 'gemini-pro';
  readonly type = 'gemini';
  readonly role = '创意发散与视觉设计';
  readonly capabilities = ['创意思维', 'UI设计建议', 'UX优化', '视觉效果', '交互设计'];
  readonly callType = 'cli';

  private status: AgentStatus = AgentStatus.OFFLINE;
  private readonly keywords = ['设计', 'ui', 'ux', '界面', '视觉', '交互', '创意', '美化'];
  private readonly geminiSessionsByWorkspaceSession = new Map<string, string>();

  constructor(
    private readonly cliRunner: CliRunnerService,
    private readonly configService: ConfigService,
    private readonly sharedMemoryService: SharedMemoryService,
  ) {}

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    const cliPath = this.configService.getOrThrow<string>('GEMINI_CLI_PATH');
    const timeoutMs = Number(this.configService.getOrThrow<string>('GEMINI_TIMEOUT_MS'));
    this.status = AgentStatus.BUSY;

    try {
      const existingGeminiSessionId = await this.resolveExistingGeminiSessionId(context.sessionId);
      const result = await this.runGemini(cliPath, prompt, timeoutMs, existingGeminiSessionId);

      const parsed = this.parseCliOutput(result.stdout);
      const geminiSessionId = this.extractGeminiSessionId(parsed.metadata);
      if (geminiSessionId) {
        await this.persistGeminiSessionBinding(context.sessionId, geminiSessionId);
      }

      this.status = AgentStatus.ONLINE;
      return {
        content: parsed.content,
        metadata: {
          ...parsed.metadata,
          geminiSessionId,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      this.status = AgentStatus.ERROR;
      throw error;
    }
  }

  async *streamGenerate(_prompt: string, _context: AgentContext): AsyncGenerator<string> {
    throw new Error('Gemini CLI does not support streaming in Sprint 2');
  }

  async shouldRespond(message: Message, _context: AgentContext): Promise<DecisionResult> {
    const text = message.content.toLowerCase();
    if (/@gemini\b/i.test(message.content)) {
      return { should: true, reason: 'direct mention @Gemini', priority: 'high' };
    }
    if (this.keywords.some((keyword) => text.includes(keyword))) {
      return { should: true, reason: 'design keywords matched', priority: 'medium' };
    }
    return { should: false, reason: 'no matching rule' };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const cliPath = this.configService.getOrThrow<string>('GEMINI_CLI_PATH');
      await this.cliRunner.run({
        command: cliPath,
        args: ['--version'],
        timeout: 5000,
      });
      return true;
    } catch (error) {
      if (error instanceof CliNotFoundError) {
        return false;
      }
      return false;
    }
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private async runGemini(
    cliPath: string,
    prompt: string,
    timeoutMs: number,
    existingGeminiSessionId?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const baseArgs = ['-p', prompt, '--output-format', 'json'];

    if (!existingGeminiSessionId) {
      return this.cliRunner.run({
        command: cliPath,
        args: baseArgs,
        timeout: timeoutMs,
      });
    }

    try {
      return await this.cliRunner.run({
        command: cliPath,
        args: ['-r', existingGeminiSessionId, ...baseArgs],
        timeout: timeoutMs,
      });
    } catch (error) {
      if (!this.shouldFallbackToFreshSession(error)) {
        throw error;
      }
      return this.cliRunner.run({
        command: cliPath,
        args: baseArgs,
        timeout: timeoutMs,
      });
    }
  }

  private async resolveExistingGeminiSessionId(workspaceSessionId: string): Promise<string | undefined> {
    const localSessionId = this.geminiSessionsByWorkspaceSession.get(workspaceSessionId);
    if (localSessionId) {
      return localSessionId;
    }

    try {
      const binding = await this.sharedMemoryService.getAgentThreadBinding(workspaceSessionId, this.id);
      if (!binding?.threadId) {
        return undefined;
      }
      this.geminiSessionsByWorkspaceSession.set(workspaceSessionId, binding.threadId);
      return binding.threadId;
    } catch {
      return undefined;
    }
  }

  private async persistGeminiSessionBinding(workspaceSessionId: string, geminiSessionId: string): Promise<void> {
    this.geminiSessionsByWorkspaceSession.set(workspaceSessionId, geminiSessionId);
    try {
      await this.sharedMemoryService.setAgentThreadBinding(workspaceSessionId, this.id, geminiSessionId);
    } catch {
      // Redis 不可用时降级到进程内映射
    }
  }

  private extractGeminiSessionId(metadata?: Record<string, unknown>): string | undefined {
    if (!metadata) {
      return undefined;
    }
    const value = metadata.session_id;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private shouldFallbackToFreshSession(error: unknown): boolean {
    if (!(error instanceof CliExitError)) {
      return false;
    }
    const stderr = error.stderr.toLowerCase();
    return stderr.includes('not found') || stderr.includes('no session') || stderr.includes('invalid');
  }

  private parseCliOutput(stdout: string): { content: string; metadata?: Record<string, unknown> } {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { content: '' };
    }

    try {
      const json = JSON.parse(trimmed) as { content?: string; message?: string; response?: string; [key: string]: unknown };
      const content =
        typeof json.content === 'string'
          ? json.content
          : typeof json.message === 'string'
            ? json.message
            : typeof json.response === 'string'
              ? json.response
              : trimmed;
      return {
        content,
        metadata: json,
      };
    } catch {
      return { content: trimmed };
    }
  }
}
