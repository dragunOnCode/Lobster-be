import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GatewayModule } from './gateway/gateway.module';
import { AgentsModule } from './agents/agents.module';
import { DatabaseModule } from './database/database.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { ChatModule } from './chat/chat.module';
import { MemoryModule } from './memory/memory.module';
import { LobsterConfigModule } from './config/config.module';
import { TasksModule } from './tasks/tasks.module';
import { VectorModule } from './vector/vector.module';
import { LangGraphModule } from './langgraph/langgraph.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GatewayModule,
    AgentsModule,
    DatabaseModule,
    WorkspaceModule,
    ChatModule,
    MemoryModule,
    LobsterConfigModule,
    TasksModule,
    VectorModule,
    LangGraphModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
