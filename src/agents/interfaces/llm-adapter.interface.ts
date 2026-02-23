export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  userId?: string;
  agentId?: string;
  createdAt?: Date;
}

export interface SharedMemory {
  summary?: string;
  facts?: string[];
  metadata?: Record<string, unknown>;
}

export interface SemanticContextItem {
  id: string;
  content: string;
  similarity: number;
  timestamp?: string;
}

export interface WorkspaceChangeEvent {
  type: 'file_created' | 'file_updated' | 'file_deleted';
  path: string;
  author?: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

export interface AgentContext {
  sessionId: string;
  userId?: string;
  conversationHistory?: Message[];
  semanticContext?: SemanticContextItem[];
  summaries?: string[];
  sharedMemory?: SharedMemory;
  workspaceChange?: WorkspaceChangeEvent;
}

export interface AgentResponse {
  content: string;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface DecisionResult {
  should: boolean;
  reason?: string;
  priority?: 'high' | 'medium' | 'low';
}

export enum AgentStatus {
  ONLINE = 'online',
  BUSY = 'busy',
  OFFLINE = 'offline',
  ERROR = 'error',
}

export interface ILLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly type: string;
  readonly role: string;
  readonly capabilities: string[];
  readonly callType: 'cli' | 'http';

  generate(prompt: string, context: AgentContext): Promise<AgentResponse>;
  streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string>;
  shouldRespond(message: Message, context: AgentContext): Promise<DecisionResult>;
  healthCheck(): Promise<boolean>;
  getStatus(): AgentStatus;
}
