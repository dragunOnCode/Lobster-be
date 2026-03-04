import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AgentService } from './agent.service';
import { CliRunnerService } from './cli-runner.service';
import { PromptContextBuilderService } from './prompt-context-builder.service';
import { ClaudeAdapter } from '../adapters/claude.adapter';
import { CodexAdapter } from '../adapters/codex.adapter';
import { GeminiAdapter } from '../adapters/gemini.adapter';
import {
  AgentConfigEntry,
  AgentsConfig,
  ILLMAdapter,
  AgentContext,
  AgentResponse,
  AgentStatus,
  DecisionResult,
  Message,
} from '../interfaces';

export interface ReloadResult {
  enabled: string[];
  disabled: string[];
  updated: string[];
}

class ConfigDrivenAdapter implements ILLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly type: string;
  readonly role: string;
  readonly capabilities: string[];
  readonly callType: 'cli' | 'http';

  constructor(
    private readonly base: ILLMAdapter,
    entry: AgentConfigEntry,
  ) {
    this.id = entry.id;
    this.name = entry.name;
    this.model = entry.model;
    this.type = entry.type;
    this.role = entry.role;
    this.capabilities = entry.capabilities ?? base.capabilities;
    this.callType = entry.callType;
  }

  generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    return this.base.generate(prompt, context);
  }

  streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string> {
    return this.base.streamGenerate(prompt, context);
  }

  shouldRespond(message: Message, context: AgentContext): Promise<DecisionResult> {
    return this.base.shouldRespond(message, context);
  }

  healthCheck(): Promise<boolean> {
    return this.base.healthCheck();
  }

  getStatus(): AgentStatus {
    return this.base.getStatus();
  }
}

@Injectable()
export class AgentConfigService implements OnModuleInit {
  private readonly logger = new Logger(AgentConfigService.name);
  private currentConfig: AgentsConfig | null = null;
  private readonly configPath: string;

  constructor(
    private readonly agentService: AgentService,
    private readonly cliRunner: CliRunnerService,
    private readonly configService: ConfigService,
    private readonly promptContextBuilder: PromptContextBuilderService,
  ) {
    this.configPath = path.resolve(process.cwd(), 'config', 'agents.config.json');
  }

  async onModuleInit(): Promise<void> {
    try {
      const config = await this.loadConfigFile();
      this.currentConfig = config;
      this.registerFromConfig(config);
      this.logger.log(`Loaded ${config.agents.filter((a) => a.enabled).length} enabled agents from config`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to load agent config, no agents registered: ${reason}`);
    }
  }

  async reload(newConfig: AgentsConfig): Promise<ReloadResult> {
    const oldConfig = this.currentConfig;
    const result = this.computeAndApplyDiff(oldConfig, newConfig);
    this.currentConfig = newConfig;
    return result;
  }

  getFallbackAgentId(): string {
    const global = this.currentConfig?.global as { decisionEngine?: { fallbackAgent?: string } } | undefined;
    return global?.decisionEngine?.fallbackAgent ?? 'claude-001';
  }

  getAgentConfigs(): AgentConfigEntry[] {
    return this.currentConfig?.agents ?? [];
  }

  getCurrentConfig(): AgentsConfig | null {
    return this.currentConfig;
  }

  createAdapter(entry: AgentConfigEntry): ILLMAdapter {
    const base = this.createBaseAdapter(entry.type);
    return new ConfigDrivenAdapter(base, entry);
  }

  private createBaseAdapter(type: string): ILLMAdapter {
    switch (type) {
      case 'claude':
        return new ClaudeAdapter(this.cliRunner, this.configService, this.promptContextBuilder);
      case 'codex':
        return new CodexAdapter(this.cliRunner, this.configService, this.promptContextBuilder);
      case 'gemini':
        return new GeminiAdapter(this.cliRunner, this.configService, this.promptContextBuilder);
      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
  }

  private registerFromConfig(config: AgentsConfig): void {
    for (const entry of config.agents) {
      if (!entry.enabled) {
        continue;
      }
      try {
        const adapter = this.createAdapter(entry);
        this.agentService.registerAgent(adapter);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to create adapter for "${entry.id}": ${reason}`);
      }
    }
  }

  private computeAndApplyDiff(oldConfig: AgentsConfig | null, newConfig: AgentsConfig): ReloadResult {
    const oldMap = new Map((oldConfig?.agents ?? []).map((a) => [a.id, a]));
    const newMap = new Map(newConfig.agents.map((a) => [a.id, a]));

    const enabled: string[] = [];
    const disabled: string[] = [];
    const updated: string[] = [];

    for (const [id, oldEntry] of oldMap) {
      const newEntry = newMap.get(id);
      if (!newEntry || !newEntry.enabled) {
        if (oldEntry.enabled) {
          this.agentService.unregisterAgent(id);
          disabled.push(id);
          this.logger.log(`Agent removed/disabled: ${id}`);
        }
      }
    }

    for (const [id, newEntry] of newMap) {
      if (!newEntry.enabled) {
        continue;
      }

      const oldEntry = oldMap.get(id);

      if (!oldEntry || !oldEntry.enabled) {
        try {
          const adapter = this.createAdapter(newEntry);
          this.agentService.registerAgent(adapter);
          enabled.push(id);
          this.logger.log(`Agent enabled: ${id}`);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to enable agent "${id}": ${reason}`);
        }
        continue;
      }

      if (this.hasConfigChanged(oldEntry, newEntry)) {
        try {
          this.agentService.unregisterAgent(id);
          const adapter = this.createAdapter(newEntry);
          this.agentService.registerAgent(adapter);
          updated.push(id);
          this.logger.log(`Agent updated (recreated): ${id}`);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to update agent "${id}": ${reason}`);
        }
      }
    }

    return { enabled, disabled, updated };
  }

  private hasConfigChanged(a: AgentConfigEntry, b: AgentConfigEntry): boolean {
    return (
      a.name !== b.name ||
      a.model !== b.model ||
      a.type !== b.type ||
      a.role !== b.role ||
      a.callType !== b.callType ||
      JSON.stringify(a.config) !== JSON.stringify(b.config) ||
      JSON.stringify(a.capabilities) !== JSON.stringify(b.capabilities)
    );
  }

  async loadConfigFile(): Promise<AgentsConfig> {
    const raw = await fs.readFile(this.configPath, 'utf-8');
    const parsed = JSON.parse(raw) as AgentsConfig;
    this.validateConfig(parsed);
    return parsed;
  }

  private validateConfig(config: unknown): asserts config is AgentsConfig {
    if (!config || typeof config !== 'object') {
      throw new Error('Config must be a JSON object');
    }

    const obj = config as Record<string, unknown>;
    if (!Array.isArray(obj.agents)) {
      throw new Error('Config must contain an "agents" array');
    }

    for (const agent of obj.agents as unknown[]) {
      if (!agent || typeof agent !== 'object') {
        throw new Error('Each agent entry must be an object');
      }
      const entry = agent as Record<string, unknown>;
      if (typeof entry.id !== 'string' || !entry.id.trim()) {
        throw new Error('Each agent must have a non-empty string "id"');
      }
      if (typeof entry.name !== 'string' || !entry.name.trim()) {
        throw new Error(`Agent "${entry.id}" must have a non-empty string "name"`);
      }
      if (typeof entry.enabled !== 'boolean') {
        throw new Error(`Agent "${entry.id}" must have a boolean "enabled" field`);
      }
      if (entry.callType !== 'cli' && entry.callType !== 'http') {
        throw new Error(`Agent "${entry.id}" must have callType "cli" or "http"`);
      }
    }
  }
}
