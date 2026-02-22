import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageEntity, SessionEntity } from '../database/entities';
import { MemoryModule } from '../memory/memory.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ChatService } from './chat.service';

@Module({
  imports: [TypeOrmModule.forFeature([MessageEntity, SessionEntity]), WorkspaceModule, MemoryModule],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
