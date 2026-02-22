import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { ChatModule } from '../chat/chat.module';
import { MemoryModule } from '../memory/memory.module';
import { ChatGateway } from './chat.gateway';
import { MessageRouter } from './message.router';
import { SessionManager } from './session.manager';

@Module({
  imports: [ChatModule, AgentsModule, MemoryModule],
  providers: [ChatGateway, SessionManager, MessageRouter],
  exports: [SessionManager, MessageRouter],
})
export class GatewayModule {}
