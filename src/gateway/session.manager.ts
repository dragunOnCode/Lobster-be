import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';

@Injectable()
export class SessionManager {
  private readonly sessions = new Map<string, Set<string>>();
  private readonly clients = new Map<string, Socket>();
  private readonly clientSessionIndex = new Map<string, string>();

  async addClient(sessionId: string, client: Socket): Promise<void> {
    const previousSessionId = this.clientSessionIndex.get(client.id);
    if (previousSessionId && previousSessionId !== sessionId) {
      this.removeClient(previousSessionId, client.id);
    }

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Set<string>());
    }

    this.sessions.get(sessionId)?.add(client.id);
    this.clients.set(client.id, client);
    this.clientSessionIndex.set(client.id, sessionId);
  }

  removeClient(sessionId: string, clientId: string): void {
    this.sessions.get(sessionId)?.delete(clientId);
    this.clients.delete(clientId);
    this.clientSessionIndex.delete(clientId);

    if (this.sessions.get(sessionId)?.size === 0) {
      this.sessions.delete(sessionId);
    }
  }

  removeClientById(clientId: string): string | undefined {
    const sessionId = this.clientSessionIndex.get(clientId);
    if (!sessionId) {
      return undefined;
    }

    this.removeClient(sessionId, clientId);
    return sessionId;
  }

  getSessionClients(sessionId: string): Socket[] {
    const clientIds = this.sessions.get(sessionId) ?? new Set<string>();
    return Array.from(clientIds)
      .map((id) => this.clients.get(id))
      .filter((client): client is Socket => !!client);
  }

  getSessionMemberCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.size ?? 0;
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  getSessionIdByClientId(clientId: string): string | undefined {
    return this.clientSessionIndex.get(clientId);
  }

  broadcastToSession(sessionId: string, event: string, payload: unknown, options?: { excludeClientId?: string }): void {
    const clients = this.getSessionClients(sessionId);
    for (const client of clients) {
      if (options?.excludeClientId && client.id === options.excludeClientId) {
        continue;
      }
      client.emit(event, payload);
    }
  }

  broadcastToAll(event: string, payload: unknown): void {
    for (const sessionId of this.sessions.keys()) {
      this.broadcastToSession(sessionId, event, payload);
    }
  }
}
