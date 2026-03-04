export interface ChatGraphMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  userId?: string;
  agentId?: string;
  agentName?: string;
  mentionedAgents?: string[];
  createdAt: string;
}

export interface ChatGraphTask {
  agentId: string;
  triggerMessageId: string;
  triggerRole: ChatGraphMessage['role'];
  triggerContent: string;
  reason: string;
  depth: number;
  sourceAgentId?: string;
}

export interface ChatGraphDecision {
  should: boolean;
  reason?: string;
  priority?: number;
  triggerMessageId: string;
}

export interface ChatGraphOutput {
  agentId: string;
  agentName: string;
  content: string;
  messageId: string;
  triggerMessageId: string;
  handoffTargets: string[];
  createdAt: string;
}

export interface ChatGraphEvent {
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ChatGraphState {
  sessionId: string;
  userId?: string;
  activeMessage?: ChatGraphMessage;
  history: ChatGraphMessage[];
  workspaceState?: Record<string, unknown>;
  summaries: string[];
  pendingTasks: ChatGraphTask[];
  taskFingerprints: string[];
  decisions: Record<string, ChatGraphDecision>;
  agentOutputs: ChatGraphOutput[];
  events: ChatGraphEvent[];
  completedTaskCount: number;
  maxAgentTurns: number;
  maxHandoffDepth: number;
}
