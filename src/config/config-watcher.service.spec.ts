import { Test, TestingModule } from '@nestjs/testing';
import { ConfigWatcherService } from './config-watcher.service';
import { AgentConfigService } from '../agents/services/agent-config.service';
import { SessionManager } from '../gateway/session.manager';
import { AgentsConfig } from '../agents/interfaces';
import * as fs from 'fs/promises';

jest.mock('chokidar', () => ({
  watch: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('fs/promises');

const mockAgentConfigService = {
  reload: jest.fn(),
};

const mockSessionManager = {
  broadcastToAll: jest.fn(),
};

const validConfig: AgentsConfig = {
  version: '1.0.0',
  agents: [
    {
      id: 'claude-001',
      name: 'Claude',
      model: 'anthropic/claude-3-sonnet',
      type: 'claude',
      enabled: true,
      role: 'architect',
      callType: 'http',
    },
    {
      id: 'codex-001',
      name: 'Codex',
      model: 'codex-cli',
      type: 'codex',
      enabled: true,
      role: 'reviewer',
      callType: 'cli',
    },
    {
      id: 'gemini-001',
      name: 'Gemini',
      model: 'gemini-pro',
      type: 'gemini',
      enabled: false,
      role: 'designer',
      callType: 'cli',
    },
  ],
};

describe('ConfigWatcherService', () => {
  let service: ConfigWatcherService;

  beforeEach(async () => {
    jest.clearAllMocks();

    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(validConfig));
    mockAgentConfigService.reload.mockResolvedValue({
      enabled: [],
      disabled: [],
      updated: [],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigWatcherService,
        { provide: AgentConfigService, useValue: mockAgentConfigService },
        { provide: SessionManager, useValue: mockSessionManager },
      ],
    }).compile();

    service = module.get<ConfigWatcherService>(ConfigWatcherService);
  });

  describe('loadAndValidateConfig', () => {
    it('should load and parse a valid config file', async () => {
      const config = await service.loadAndValidateConfig();
      expect(config.version).toBe('1.0.0');
      expect(config.agents).toHaveLength(3);
    });

    it('should reject config without agents array', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ version: '1.0.0' }));
      await expect(service.loadAndValidateConfig()).rejects.toThrow('Config must contain an "agents" array');
    });

    it('should reject config with invalid JSON', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue('not-json{{{');
      await expect(service.loadAndValidateConfig()).rejects.toThrow();
    });

    it('should reject agent without id', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          version: '1.0.0',
          agents: [{ name: 'Test', enabled: true, callType: 'http' }],
        }),
      );
      await expect(service.loadAndValidateConfig()).rejects.toThrow('non-empty string "id"');
    });

    it('should reject agent without name', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          version: '1.0.0',
          agents: [{ id: 'test', enabled: true, callType: 'http' }],
        }),
      );
      await expect(service.loadAndValidateConfig()).rejects.toThrow('non-empty string "name"');
    });

    it('should reject agent without boolean enabled', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          version: '1.0.0',
          agents: [{ id: 'test', name: 'Test', enabled: 'yes', callType: 'http' }],
        }),
      );
      await expect(service.loadAndValidateConfig()).rejects.toThrow('boolean "enabled"');
    });

    it('should reject agent with invalid callType', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          version: '1.0.0',
          agents: [
            {
              id: 'test',
              name: 'Test',
              enabled: true,
              callType: 'websocket',
            },
          ],
        }),
      );
      await expect(service.loadAndValidateConfig()).rejects.toThrow('callType "cli" or "http"');
    });
  });

  describe('onModuleInit', () => {
    it('should start watching without errors', async () => {
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('onModuleDestroy', () => {
    it('should stop watcher without errors', async () => {
      await service.onModuleInit();
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe('reloadAgentsConfig', () => {
    it('should delegate to AgentConfigService.reload() and broadcast success', async () => {
      mockAgentConfigService.reload.mockResolvedValue({
        enabled: ['gemini-001'],
        disabled: ['codex-001'],
        updated: [],
      });

      await service.reloadAgentsConfig();

      expect(mockAgentConfigService.reload).toHaveBeenCalledWith(expect.objectContaining({ version: '1.0.0' }));
      expect(mockSessionManager.broadcastToAll).toHaveBeenCalledWith(
        'system:notification',
        expect.objectContaining({
          type: 'config_reloaded',
          message: 'Agent configuration reloaded',
          details: expect.objectContaining({
            enabled: ['gemini-001'],
            disabled: ['codex-001'],
            updated: [],
            total: expect.any(Number),
          }),
        }),
      );
    });

    it('should broadcast failure when config file is invalid', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue('invalid-json');

      await service.reloadAgentsConfig();

      expect(mockAgentConfigService.reload).not.toHaveBeenCalled();
      expect(mockSessionManager.broadcastToAll).toHaveBeenCalledWith(
        'system:notification',
        expect.objectContaining({
          type: 'config_reload_failed',
        }),
      );
    });

    it('should broadcast failure when AgentConfigService.reload() throws', async () => {
      mockAgentConfigService.reload.mockRejectedValue(new Error('internal error'));

      await service.reloadAgentsConfig();

      expect(mockSessionManager.broadcastToAll).toHaveBeenCalledWith(
        'system:notification',
        expect.objectContaining({
          type: 'config_reload_failed',
          message: expect.stringContaining('internal error'),
        }),
      );
    });
  });
});
