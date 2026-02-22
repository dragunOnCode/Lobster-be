import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as chokidar from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AgentConfigService } from '../agents/services/agent-config.service';
import { SessionManager } from '../gateway/session.manager';
import { AgentsConfig } from '../agents/interfaces';

@Injectable()
export class ConfigWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConfigWatcherService.name);
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly debounceMs = 500;
  private readonly configDir: string;
  private readonly agentsConfigPath: string;

  constructor(
    private readonly agentConfigService: AgentConfigService,
    private readonly sessionManager: SessionManager,
  ) {
    this.configDir = path.resolve(process.cwd(), 'config');
    this.agentsConfigPath = path.join(this.configDir, 'agents.config.json');
  }

  async onModuleInit(): Promise<void> {
    this.startWatching();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopWatching();
  }

  private startWatching(): void {
    try {
      this.watcher = chokidar.watch(this.configDir, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100,
        },
      });

      this.watcher.on('change', (filePath: string) => this.handleFileChange(filePath));

      this.watcher.on('error', (error: Error) => this.logger.error(`Watcher error: ${error.message}`));

      this.logger.log(`Watching config directory: ${this.configDir}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start config watcher: ${reason}`);
    }
  }

  private stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close().catch((err) => {
        this.logger.error(`Error closing watcher: ${err}`);
      });
      this.watcher = null;
    }
  }

  private handleFileChange(filePath: string): void {
    const normalized = path.normalize(filePath);
    if (!normalized.endsWith('agents.config.json')) {
      return;
    }

    this.logger.log(`Detected config change: ${normalized}`);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.reloadAgentsConfig().catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.error(`Reload failed: ${reason}`);
      });
    }, this.debounceMs);
  }

  async reloadAgentsConfig(): Promise<void> {
    let newConfig: AgentsConfig;

    try {
      newConfig = await this.loadAndValidateConfig();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Invalid config file, keeping current config: ${reason}`);
      this.broadcastNotification('config_reload_failed', `Configuration file is invalid: ${reason}`);
      return;
    }

    try {
      const changes = await this.agentConfigService.reload(newConfig);

      this.logger.log(
        `Config reloaded: ${changes.enabled.length} enabled, ${changes.disabled.length} disabled, ${changes.updated.length} updated`,
      );

      this.broadcastNotification('config_reloaded', 'Agent configuration reloaded', {
        enabled: changes.enabled,
        disabled: changes.disabled,
        updated: changes.updated,
        total: newConfig.agents.filter((a) => a.enabled).length,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to apply config changes: ${reason}`);
      this.broadcastNotification('config_reload_failed', `Failed to apply changes: ${reason}`);
    }
  }

  async loadAndValidateConfig(): Promise<AgentsConfig> {
    const raw = await fs.readFile(this.agentsConfigPath, 'utf-8');
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

  private broadcastNotification(type: string, message: string, details?: Record<string, unknown>): void {
    this.sessionManager.broadcastToAll('system:notification', {
      type,
      message,
      details,
      timestamp: new Date().toISOString(),
    });
  }
}
