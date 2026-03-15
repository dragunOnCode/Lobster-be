import { Injectable, OnModuleInit } from '@nestjs/common';
import { ILLMAdapter } from '../interfaces';
import { EventBusService, WorkspaceChangeEvent } from '../../memory/services/event-bus.service';

@Injectable()
export class AgentService implements OnModuleInit {
  private readonly agentRegistry = new Map<string, ILLMAdapter>();

  constructor(private readonly eventBusService: EventBusService) {}

  async onModuleInit(): Promise<void> {
    await this.eventBusService.subscribe<WorkspaceChangeEvent>('workspace:change', async (event) => {
      const agents = await this.getAllAgents();
      await Promise.allSettled(
        agents.map((agent) =>
          agent.shouldRespond(
            {
              id: `workspace-change-${Date.now()}`,
              sessionId: event.sessionId,
              role: 'system',
              content: `Workspace changed: ${event.changeType} ${event.filePath}`,
            },
            {
              sessionId: event.sessionId,
              workspaceChange: {
                type: event.changeType,
                path: event.filePath,
                timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
              },
            },
          ),
        ),
      );
    });
  }

  async getAgent(agentId: string): Promise<ILLMAdapter> {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    return agent;
  }

  registerAgent(agent: ILLMAdapter): void {
    this.agentRegistry.set(agent.id, agent);
  }

  unregisterAgent(agentId: string): void {
    this.agentRegistry.delete(agentId);
  }

  async getAllAgents(): Promise<ILLMAdapter[]> {
    return Array.from(this.agentRegistry.values());
  }

  async getAgentByName(name: string): Promise<ILLMAdapter> {
    const normalized = name.trim().toLowerCase();
    const agent = Array.from(this.agentRegistry.values()).find((item) => item.name.trim().toLowerCase() === normalized);
    if (!agent) {
      throw new Error(`Agent not found by name: ${name}`);
    }
    return agent;
  }

  getRegisteredAgentIds(): string[] {
    return Array.from(this.agentRegistry.keys());
  }
}
