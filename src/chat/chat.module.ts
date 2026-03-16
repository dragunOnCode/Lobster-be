import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageEntity, SessionEntity } from '../database/entities';
import { MemoryModule } from '../memory/memory.module';
import { VectorModule } from '../vector/vector.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ChatService } from './chat.service';
import { ConversationSummaryService } from './conversation-summary.service';
import { RewindCompensationQueueService } from './rewind-compensation-queue.service';
import { RewindCompensationWorkerService } from './rewind-compensation-worker.service';

@Module({
  imports: [TypeOrmModule.forFeature([MessageEntity, SessionEntity]), WorkspaceModule, MemoryModule, VectorModule],
  providers: [ChatService, ConversationSummaryService, RewindCompensationQueueService, RewindCompensationWorkerService],
  exports: [ChatService],
})
export class ChatModule {}
