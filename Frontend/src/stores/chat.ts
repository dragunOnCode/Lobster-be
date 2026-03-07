import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { io, type Socket } from 'socket.io-client';
import type {
  AgentState,
  ChatMessage,
  ConnectionConfig,
  ConnectionStatus,
  DebugEvent,
  StreamDraft,
} from '../types/chat';

interface StreamPayload {
  agentId: string;
  agentName: string;
  sessionId: string;
  delta: string;
  timestamp: string;
}

interface StreamEndPayload {
  agentId: string;
  agentName: string;
  sessionId: string;
  fullContent: string;
  timestamp: string;
}

const MAX_EVENTS = 1000;
const ENTRY_SESSION_WAIT_TIMEOUT_MS = 6000;
const DEFAULT_AGENTS = [
  { agentId: 'claude-001', agentName: 'Claude' },
  { agentId: 'codex-001', agentName: 'Codex' },
  { agentId: 'gemini-001', agentName: 'Gemini' },
];

let socketRef: Socket | null = null;
let entrySessionTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function getDefaultBaseUrl(): string {
  const envUrl = import.meta.env.VITE_CHAT_BASE_URL || import.meta.env.VITE_API_BASE_URL;
  if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return normalizeBaseUrl(envUrl.trim());
  }

  if (typeof window === 'undefined') {
    return 'http://localhost:3000';
  }

  const { protocol, hostname, port, origin } = window.location;
  const vitePorts = new Set(['5173', '4173']);
  if (vitePorts.has(port)) {
    return `${protocol}//${hostname}:3000`;
  }

  return normalizeBaseUrl(origin);
}

export interface SessionInfo {
  id: string;
  title: string;
}

export const useChatStore = defineStore('chat', () => {
  const config = ref<ConnectionConfig>({
    baseUrl: getDefaultBaseUrl(),
    namespace: '/chat',
    sessionId: '',
    userId: 'demo-user',
    token: '',
  });
  const connectionStatus = ref<ConnectionStatus>('disconnected');
  const connectionError = ref('');
  const messages = ref<ChatMessage[]>([]);
  const sessionHistory = ref<SessionInfo[]>([]);
  const enteredChatMode = ref(false);
  const isEnteringChatMode = ref(false);
  const pendingEntrySessionId = ref('');
  const sessionListLoaded = ref(false);
  const hasResolvedEntrySession = ref(false);
  const debugEvents = ref<DebugEvent[]>([]);
  const eventKeyword = ref('');
  const eventTypeFilter = ref('all');
  const streamBuffer = ref<Record<string, StreamDraft>>({});
  const errorMessageIds = ref<Set<string>>(new Set());
  const agentStates = ref<Record<string, AgentState>>(
    DEFAULT_AGENTS.reduce<Record<string, AgentState>>((acc, agent) => {
      acc[agent.agentId] = {
        ...agent,
        status: 'idle',
        updatedAt: new Date().toISOString(),
      };
      return acc;
    }, {}),
  );

  const filteredEvents = computed(() => {
    return debugEvents.value.filter((item) => {
      const byType = eventTypeFilter.value === 'all' || item.event === eventTypeFilter.value;
      const payloadText = JSON.stringify(item.payload ?? '').toLowerCase();
      const byKeyword =
        !eventKeyword.value ||
        item.event.toLowerCase().includes(eventKeyword.value.toLowerCase()) ||
        payloadText.includes(eventKeyword.value.toLowerCase());
      return byType && byKeyword;
    });
  });

  const eventTypeOptions = computed(() => {
    const eventSet = new Set(debugEvents.value.map((item) => item.event));
    return [{ label: 'All Events', value: 'all' }, ...Array.from(eventSet).map((event) => ({ label: event, value: event }))];
  });

  function updateConfig(nextConfig: Partial<ConnectionConfig>) {
    config.value = {
      ...config.value,
      ...nextConfig,
      baseUrl: nextConfig.baseUrl ? normalizeBaseUrl(nextConfig.baseUrl) : config.value.baseUrl,
    };
  }

  function changeSession(sessionId: string) {
    if (config.value.sessionId === sessionId) return;
    updateConfig({ sessionId });
    messages.value = [];
    streamBuffer.value = {};
    connect(true);
  }

  function createNewSession() {
    const newSessionId = crypto.randomUUID();
    changeSession(newSessionId);
    return newSessionId;
  }

  function clearEntrySessionTimer() {
    if (!entrySessionTimer) {
      return;
    }
    clearTimeout(entrySessionTimer);
    entrySessionTimer = null;
  }

  function startEntrySessionTimer() {
    clearEntrySessionTimer();
    entrySessionTimer = setTimeout(() => {
      if (!isEnteringChatMode.value || hasResolvedEntrySession.value) {
        return;
      }
      const fallbackSessionId = pendingEntrySessionId.value || config.value.sessionId || crypto.randomUUID();
      finalizeEnterChatMode(fallbackSessionId);
    }, ENTRY_SESSION_WAIT_TIMEOUT_MS);
  }

  function finalizeEnterChatMode(sessionId: string) {
    if (!sessionId) {
      return;
    }
    clearEntrySessionTimer();
    hasResolvedEntrySession.value = true;
    pendingEntrySessionId.value = '';
    if (config.value.sessionId !== sessionId) {
      changeSession(sessionId);
    }
    enteredChatMode.value = true;
    isEnteringChatMode.value = false;
  }

  function resolveInitialSessionOnEnter() {
    if (!isEnteringChatMode.value || hasResolvedEntrySession.value) {
      return;
    }

    if (sessionHistory.value.length > 0) {
      finalizeEnterChatMode(sessionHistory.value[0].id);
      return;
    }

    if (sessionListLoaded.value) {
      const newSessionId = pendingEntrySessionId.value || config.value.sessionId || crypto.randomUUID();
      finalizeEnterChatMode(newSessionId);
    }
  }

  function enterChatMode() {
    if (enteredChatMode.value || isEnteringChatMode.value) {
      return;
    }
    const bootstrapSessionId = crypto.randomUUID();
    pendingEntrySessionId.value = bootstrapSessionId;
    isEnteringChatMode.value = true;
    sessionListLoaded.value = false;
    hasResolvedEntrySession.value = false;
    updateConfig({ sessionId: bootstrapSessionId });
    messages.value = [];
    streamBuffer.value = {};
    connect(true);
    startEntrySessionTimer();
    resolveInitialSessionOnEnter();
  }

  function renameSession(sessionId: string, title: string) {
    // Update local state immediately for instant UI feedback
    const idx = sessionHistory.value.findIndex((s) => s.id === sessionId);
    if (idx >= 0) {
      sessionHistory.value[idx] = { ...sessionHistory.value[idx], title };
    }
    // Sync to backend
    if (!socketRef || !socketRef.connected) return;
    socketRef.emit('session:rename', { sessionId, title });
  }

  function pushDebugEvent(event: Omit<DebugEvent, 'id' | 'timestamp'>) {
    debugEvents.value.unshift({
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });
    if (debugEvents.value.length > MAX_EVENTS) {
      debugEvents.value.length = MAX_EVENTS;
    }
  }

  function upsertAgentState(agentId: string, agentName: string, status: AgentState['status'], reason?: string) {
    agentStates.value[agentId] = {
      agentId,
      agentName,
      status,
      reason,
      updatedAt: new Date().toISOString(),
    };
  }

  function getStreamKey(sessionId: string, agentId: string) {
    return `${sessionId}:${agentId}`;
  }

  function sortMessages() {
    messages.value.sort((left, right) => {
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
  }

  function upsertMessage(message: ChatMessage) {
    const index = messages.value.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      messages.value[index] = message;
    } else {
      messages.value.push(message);
    }
    sortMessages();
  }

  function clearStreamDraft(sessionId: string, agentId?: string) {
    if (!agentId) {
      return;
    }
    delete streamBuffer.value[getStreamKey(sessionId, agentId)];
  }

  function registerSocketEvents() {
    if (!socketRef) {
      return;
    }

    socketRef.on('connect', () => {
      connectionStatus.value = 'connected';
      connectionError.value = '';
    });

    socketRef.on('disconnect', () => {
      connectionStatus.value = 'disconnected';
    });

    socketRef.on('connect_error', (error: Error) => {
      connectionStatus.value = 'error';
      connectionError.value = error.message;
      pushDebugEvent({
        direction: 'inbound',
        event: 'connect_error',
        payload: { message: error.message },
        sessionId: config.value.sessionId,
      });
    });

    socketRef.io.on('reconnect_attempt', () => {
      connectionStatus.value = 'reconnecting';
    });

    socketRef.onAny((eventName, payload) => {
      pushDebugEvent({
        direction: 'inbound',
        event: eventName,
        payload,
        sessionId: payload?.sessionId,
        agentId: payload?.agentId,
      });
    });

    socketRef.on('chat:history', (history: ChatMessage[]) => {
      messages.value = history ?? [];
      sortMessages();
      streamBuffer.value = {};
    });

    socketRef.on('session:list', (sessions: SessionInfo[]) => {
      sessionHistory.value = sessions ?? [];
      sessionListLoaded.value = true;
      resolveInitialSessionOnEnter();
    });

    socketRef.on('message:received', (message: ChatMessage) => {
      upsertMessage(message);
      if (message.role === 'assistant' && message.agentId && message.agentName) {
        clearStreamDraft(message.sessionId, message.agentId);
        upsertAgentState(message.agentId, message.agentName, 'idle');
      }
    });

    socketRef.on('message:error', (payload: { message?: string }) => {
      connectionError.value = payload?.message || 'message send failed';
    });

    socketRef.on('agent:skip', (payload: { agentId: string; agentName: string; reason?: string }) => {
      upsertAgentState(payload.agentId, payload.agentName, 'skip', payload.reason);
    });

    socketRef.on('agent:error', (payload: { agentId?: string; agentName?: string; messageId?: string; error?: string }) => {
      if (payload.messageId) {
        errorMessageIds.value = new Set([...errorMessageIds.value, payload.messageId]);
      }
      if (!payload.agentId || !payload.agentName) {
        return;
      }
      upsertAgentState(payload.agentId, payload.agentName, 'error', payload.error);
    });

    socketRef.on('agent:thinking', (payload: { agentId: string; agentName: string; reason?: string; triggerMessageId?: string }) => {
      if (payload.triggerMessageId) {
        const next = new Set(errorMessageIds.value);
        next.delete(payload.triggerMessageId);
        errorMessageIds.value = next;
      }
      upsertAgentState(payload.agentId, payload.agentName, 'thinking', payload.reason);
    });

    socketRef.on('agent:stream', (payload: StreamPayload) => {
      const key = getStreamKey(payload.sessionId, payload.agentId);
      const current = streamBuffer.value[key];
      streamBuffer.value[key] = {
        key,
        sessionId: payload.sessionId,
        agentId: payload.agentId,
        agentName: payload.agentName,
        content: `${current?.content ?? ''}${payload.delta}`,
        updatedAt: payload.timestamp || new Date().toISOString(),
        finalized: false,
      };
      upsertAgentState(payload.agentId, payload.agentName, 'responding');
    });

    socketRef.on('agent:stream:end', (payload: StreamEndPayload) => {
      const key = getStreamKey(payload.sessionId, payload.agentId);
      const current = streamBuffer.value[key];
      streamBuffer.value[key] = {
        key,
        sessionId: payload.sessionId,
        agentId: payload.agentId,
        agentName: payload.agentName,
        content: payload.fullContent || current?.content || '',
        updatedAt: payload.timestamp || new Date().toISOString(),
        finalized: true,
      };
    });
  }

  function connect(forceReconnect = false) {
    const sessionId = config.value.sessionId?.trim();
    if (!sessionId) {
      connectionStatus.value = 'disconnected';
      return;
    }

    if (socketRef?.connected && !forceReconnect) {
      return;
    }
    if (socketRef) {
      socketRef.removeAllListeners();
      socketRef.disconnect();
      socketRef = null;
    }

    connectionStatus.value = 'connecting';
    connectionError.value = '';

    socketRef = io(`${normalizeBaseUrl(config.value.baseUrl)}${config.value.namespace}`, {
      transports: ['websocket'],
      reconnection: true,
      query: {
        sessionId,
        userId: config.value.userId,
      },
      auth: config.value.token ? { token: config.value.token } : undefined,
    });

    registerSocketEvents();
  }

  function disconnect() {
    clearEntrySessionTimer();
    isEnteringChatMode.value = false;
    if (!socketRef) {
      return;
    }
    socketRef.removeAllListeners();
    socketRef.disconnect();
    socketRef = null;
    connectionStatus.value = 'disconnected';
    streamBuffer.value = {};
  }

  function retryMessage(messageId: string): boolean {
    if (!socketRef || !socketRef.connected) {
      connectionError.value = 'WebSocket is not connected';
      return false;
    }

    const payload = {
      messageId,
      sessionId: config.value.sessionId,
    };

    pushDebugEvent({
      direction: 'outbound',
      event: 'message:retry',
      payload,
      sessionId: config.value.sessionId,
    });

    socketRef.emit('message:retry', payload);
    return true;
  }

  function sendMessage(content: string): boolean {
    if (!content.trim()) {
      return false;
    }

    if (!socketRef || !socketRef.connected) {
      connectionError.value = 'WebSocket is not connected';
      pushDebugEvent({
        direction: 'outbound',
        event: 'message:blocked',
        payload: { reason: 'socket_not_connected', content },
        sessionId: config.value.sessionId,
      });
      return false;
    }

    const payload = {
      content,
      sessionId: config.value.sessionId,
    };

    pushDebugEvent({
      direction: 'outbound',
      event: 'message:send',
      payload,
      sessionId: config.value.sessionId,
    });

    socketRef.emit('message:send', payload);
    return true;
  }

  function exportEvents() {
    return JSON.stringify(debugEvents.value, null, 2);
  }

  return {
    config,
    connectionStatus,
    connectionError,
    messages,
    sessionHistory,
    enteredChatMode,
    isEnteringChatMode,
    debugEvents,
    filteredEvents,
    eventKeyword,
    eventTypeFilter,
    eventTypeOptions,
    agentStates,
    streamBuffer,
    errorMessageIds,
    updateConfig,
    changeSession,
    createNewSession,
    enterChatMode,
    renameSession,
    connect,
    disconnect,
    sendMessage,
    retryMessage,
    exportEvents,
  };
});
