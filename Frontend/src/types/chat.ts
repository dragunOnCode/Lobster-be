export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type AgentStatus = 'idle' | 'thinking' | 'responding' | 'skip' | 'error';

export interface ConnectionConfig {
  baseUrl: string;
  namespace: string;
  sessionId: string;
  userId: string;
  token: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  userId?: string;
  agentId?: string;
  agentName?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface StreamDraft {
  key: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  content: string;
  updatedAt: string;
  finalized: boolean;
}

export interface AgentState {
  agentId: string;
  agentName: string;
  status: AgentStatus;
  reason?: string;
  updatedAt: string;
}

export interface DebugEvent {
  id: string;
  direction: 'inbound' | 'outbound';
  event: string;
  timestamp: string;
  sessionId?: string;
  agentId?: string;
  payload: unknown;
}
