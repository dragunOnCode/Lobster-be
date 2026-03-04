import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { ChatModule } from '../chat/chat.module';
import { MemoryModule } from '../memory/memory.module';
import { LangGraphModule } from '../langgraph/langgraph.module';
import { ChatGateway } from './chat.gateway';
import { MessageRouter } from './message.router';
import { SessionManager } from './session.manager';
import { LangGraphEventBridgeService } from './services/langgraph-event-bridge.service';

@Module({
  imports: [ChatModule, AgentsModule, MemoryModule, LangGraphModule],
  providers: [ChatGateway, SessionManager, MessageRouter, LangGraphEventBridgeService],
  exports: [SessionManager, MessageRouter],
})
export class GatewayModule {}
