import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CliNotFoundError, CliRunnerService } from '../services/cli-runner.service';
import { AgentContext, AgentResponse, AgentStatus, DecisionResult, ILLMAdapter, Message } from '../interfaces';

@Injectable()
export class CodexAdapter implements ILLMAdapter {
  readonly id = 'codex-001';
  readonly name = 'Codex';
  readonly model = 'codex-cli';
  readonly type = 'codex';
  readonly role = '代码审查与质量把控';
  readonly capabilities = ['代码审查', '静态分析', '测试建议', '安全检查', '性能分析'];
  readonly callType = 'cli';

  private status: AgentStatus = AgentStatus.OFFLINE;
  private readonly keywords = ['审查', '检查', '测试', 'bug', '问题', '安全'];

  constructor(
    private readonly cliRunner: CliRunnerService,
    private readonly configService: ConfigService,
  ) {}

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    const cliPath = this.configService.getOrThrow<string>('CODEX_CLI_PATH');
    const timeoutMs = Number(this.configService.getOrThrow<string>('CODEX_TIMEOUT_MS'));
    this.status = AgentStatus.BUSY;

    try {
      const result = await this.cliRunner.run({
        command: cliPath,
        args: ['--format', 'json', '--timeout', String(Math.ceil(timeoutMs / 1000))],
        timeout: timeoutMs,
        input: JSON.stringify({
          prompt,
          sessionId: context.sessionId,
          userId: context.userId,
        }),
      });

      const parsed = this.parseCliOutput(result.stdout);
      this.status = AgentStatus.ONLINE;
      return {
        content: parsed.content,
        metadata: parsed.metadata,
        timestamp: new Date(),
      };
    } catch (error) {
      this.status = AgentStatus.ERROR;
      throw error;
    }
  }

  async *streamGenerate(_prompt: string, _context: AgentContext): AsyncGenerator<string> {
    throw new Error('Codex CLI does not support streaming in Sprint 2');
  }

  async shouldRespond(message: Message, context: AgentContext): Promise<DecisionResult> {
    const text = message.content.toLowerCase();
    if (/@codex\b/i.test(message.content)) {
      return { should: true, reason: 'direct mention @Codex', priority: 'high' };
    }
    if (this.keywords.some((keyword) => text.includes(keyword))) {
      return { should: true, reason: 'review keywords matched', priority: 'medium' };
    }
    if (context.workspaceChange) {
      return { should: true, reason: 'workspace changed', priority: 'medium' };
    }
    return { should: false, reason: 'no matching rule' };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const cliPath = this.configService.getOrThrow<string>('CODEX_CLI_PATH');
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

  private parseCliOutput(stdout: string): { content: string; metadata?: Record<string, unknown> } {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { content: '' };
    }

    try {
      const json = JSON.parse(trimmed) as { content?: string; message?: string; [key: string]: unknown };
      const content =
        typeof json.content === 'string' ? json.content : typeof json.message === 'string' ? json.message : trimmed;
      return {
        content,
        metadata: json,
      };
    } catch {
      return { content: trimmed };
    }
  }
}
