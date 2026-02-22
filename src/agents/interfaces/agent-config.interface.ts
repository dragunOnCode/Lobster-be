export interface AgentConfigEntry {
  id: string;
  name: string;
  model: string;
  type: string;
  enabled: boolean;
  role: string;
  description?: string;
  capabilities?: string[];
  callType: 'cli' | 'http';
  config?: Record<string, unknown>;
  decision?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
}

export interface AgentsConfig {
  version: string;
  agents: AgentConfigEntry[];
  global?: Record<string, unknown>;
}
