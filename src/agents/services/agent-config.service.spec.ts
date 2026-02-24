import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AgentConfigService } from './agent-config.service';
import { AgentService } from './agent.service';
import { CliRunnerService } from './cli-runner.service';
import { ContextBuilderService } from './context-builder.service';
import { SharedMemoryService } from '../../memory/services/shared-memory.service';
import { AgentConfigEntry, AgentsConfig } from '../interfaces';
import * as fs from 'fs/promises';

jest.mock('fs/promises');

const mockAgentService = {
  registerAgent: jest.fn(),
  unregisterAgent: jest.fn(),
  getRegisteredAgentIds: jest.fn().mockReturnValue([]),
};

const mockHttpService = {};
const mockCliRunner = {};
const mockContextBuilder = { buildContext: jest.fn() };
const mockSharedMemoryService = {
  getAgentThreadBinding: jest.fn(),
  setAgentThreadBinding: jest.fn(),
};
const mockConfigService = {
  get: jest.fn().mockReturnValue('mock'),
  getOrThrow: jest.fn().mockReturnValue('mock'),
};

const makeEntry = (overrides: Partial<AgentConfigEntry> = {}): AgentConfigEntry => ({
  id: 'claude-001',
  name: 'Claude',
  model: 'anthropic/claude-3-sonnet',
  type: 'claude',
  enabled: true,
  role: 'architect',
  callType: 'http',
  capabilities: ['coding'],
  ...overrides,
});

const makeConfig = (agents: AgentConfigEntry[]): AgentsConfig => ({
  version: '1.0.0',
  agents,
  global: {
    decisionEngine: { fallbackAgent: 'claude-001' },
  },
});

describe('AgentConfigService', () => {
  let service: AgentConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const validConfig = makeConfig([
      makeEntry(),
      makeEntry({ id: 'codex-001', name: 'Codex', type: 'codex', callType: 'cli' }),
      makeEntry({ id: 'gemini-001', name: 'Gemini', type: 'gemini', callType: 'cli', enabled: false }),
    ]);
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(validConfig));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentConfigService,
        { provide: AgentService, useValue: mockAgentService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: CliRunnerService, useValue: mockCliRunner },
        { provide: ContextBuilderService, useValue: mockContextBuilder },
        { provide: SharedMemoryService, useValue: mockSharedMemoryService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AgentConfigService>(AgentConfigService);
  });

  describe('onModuleInit', () => {
    it('should load config and register enabled agents', async () => {
      await service.onModuleInit();

      // claude-001 (enabled) + codex-001 (enabled), gemini-001 is disabled
      expect(mockAgentService.registerAgent).toHaveBeenCalledTimes(2);

      const calls = mockAgentService.registerAgent.mock.calls;
      const registeredIds = calls.map((c: unknown[]) => (c[0] as { id: string }).id);
      expect(registeredIds).toContain('claude-001');
      expect(registeredIds).toContain('codex-001');
      expect(registeredIds).not.toContain('gemini-001');
    });

    it('should not throw when config file is missing', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('createAdapter', () => {
    it('should create a ConfigDrivenAdapter with correct metadata for claude', () => {
      const entry = makeEntry({ id: 'claude-custom', name: 'MyClaudeBot' });
      const adapter = service.createAdapter(entry);

      expect(adapter.id).toBe('claude-custom');
      expect(adapter.name).toBe('MyClaudeBot');
      expect(adapter.callType).toBe('http');
    });

    it('should create a ConfigDrivenAdapter for codex type', () => {
      const entry = makeEntry({ id: 'codex-custom', type: 'codex', callType: 'cli' });
      const adapter = service.createAdapter(entry);
      expect(adapter.id).toBe('codex-custom');
      expect(adapter.callType).toBe('cli');
    });

    it('should create a ConfigDrivenAdapter for gemini type', () => {
      const entry = makeEntry({ id: 'gemini-custom', type: 'gemini', callType: 'cli' });
      const adapter = service.createAdapter(entry);
      expect(adapter.id).toBe('gemini-custom');
    });

    it('should throw for unknown agent type', () => {
      const entry = makeEntry({ type: 'unknown-llm' });
      expect(() => service.createAdapter(entry)).toThrow('Unknown agent type');
    });
  });

  describe('reload', () => {
    it('should disable agents removed from config', async () => {
      await service.onModuleInit();
      mockAgentService.registerAgent.mockClear();

      const newConfig = makeConfig([makeEntry({ id: 'codex-001', name: 'Codex', type: 'codex', callType: 'cli' })]);

      const result = await service.reload(newConfig);

      expect(mockAgentService.unregisterAgent).toHaveBeenCalledWith('claude-001');
      expect(result.disabled).toContain('claude-001');
    });

    it('should enable agents newly added to config', async () => {
      await service.onModuleInit();
      mockAgentService.registerAgent.mockClear();

      const newConfig = makeConfig([
        makeEntry(),
        makeEntry({ id: 'codex-001', name: 'Codex', type: 'codex', callType: 'cli' }),
        makeEntry({ id: 'gemini-001', name: 'Gemini', type: 'gemini', callType: 'cli', enabled: true }),
      ]);

      const result = await service.reload(newConfig);

      expect(result.enabled).toContain('gemini-001');
      expect(mockAgentService.registerAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'gemini-001' }));
    });

    it('should update agents whose config changed', async () => {
      await service.onModuleInit();
      mockAgentService.registerAgent.mockClear();
      mockAgentService.unregisterAgent.mockClear();

      const newConfig = makeConfig([
        makeEntry({ model: 'anthropic/claude-3-opus' }),
        makeEntry({ id: 'codex-001', name: 'Codex', type: 'codex', callType: 'cli' }),
      ]);

      const result = await service.reload(newConfig);

      expect(result.updated).toContain('claude-001');
      expect(mockAgentService.unregisterAgent).toHaveBeenCalledWith('claude-001');
      expect(mockAgentService.registerAgent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'claude-001', model: 'anthropic/claude-3-opus' }),
      );
    });

    it('should return empty result when configs are identical', async () => {
      await service.onModuleInit();
      mockAgentService.registerAgent.mockClear();

      const sameConfig = makeConfig([
        makeEntry(),
        makeEntry({ id: 'codex-001', name: 'Codex', type: 'codex', callType: 'cli' }),
        makeEntry({ id: 'gemini-001', name: 'Gemini', type: 'gemini', callType: 'cli', enabled: false }),
      ]);

      const result = await service.reload(sameConfig);

      expect(result.enabled).toHaveLength(0);
      expect(result.disabled).toHaveLength(0);
      expect(result.updated).toHaveLength(0);
    });
  });

  describe('getFallbackAgentId', () => {
    it('should return fallback agent from global config', async () => {
      await service.onModuleInit();
      expect(service.getFallbackAgentId()).toBe('claude-001');
    });

    it('should default to claude-001 when config is not loaded', () => {
      expect(service.getFallbackAgentId()).toBe('claude-001');
    });
  });

  describe('getAgentConfigs', () => {
    it('should return all agent entries from current config', async () => {
      await service.onModuleInit();
      const configs = service.getAgentConfigs();
      expect(configs).toHaveLength(3);
    });

    it('should return empty array when config is not loaded', () => {
      expect(service.getAgentConfigs()).toEqual([]);
    });
  });

  describe('loadConfigFile', () => {
    it('should load and validate a valid config', async () => {
      const config = await service.loadConfigFile();
      expect(config.version).toBe('1.0.0');
      expect(config.agents).toHaveLength(3);
    });

    it('should reject invalid JSON', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue('{bad json');
      await expect(service.loadConfigFile()).rejects.toThrow();
    });

    it('should reject config missing agents array', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ version: '1.0.0' }));
      await expect(service.loadConfigFile()).rejects.toThrow('agents');
    });
  });
});
