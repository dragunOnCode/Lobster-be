import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { ChatModule } from '../chat/chat.module';
import { MemoryModule } from '../memory/memory.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { FreeChatGraphService } from './graphs/free-chat.graph';
import { LangGraphThreadsController } from './langgraph.controller';
import { AgentHandoffService } from './services/agent-handoff.service';
import { LangGraphCheckpointerService } from './services/langgraph-checkpointer.service';
import { LangGraphOrchestratorService } from './services/langgraph-orchestrator.service';
import { LangGraphThreadDebugService } from './services/langgraph-thread-debug.service';

@Module({
  imports: [AgentsModule, ChatModule, MemoryModule, WorkspaceModule],
  controllers: [LangGraphThreadsController],
  providers: [
    AgentHandoffService,
    LangGraphCheckpointerService,
    FreeChatGraphService,
    LangGraphOrchestratorService,
    LangGraphThreadDebugService,
  ],
  exports: [
    AgentHandoffService,
    LangGraphCheckpointerService,
    FreeChatGraphService,
    LangGraphOrchestratorService,
    LangGraphThreadDebugService,
  ],
})
export class LangGraphModule {}
