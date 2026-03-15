import { Module } from '@nestjs/common';
import { TranscriptService } from './transcript.service';
import { WorkspaceService } from './workspace.service';

@Module({
  providers: [WorkspaceService, TranscriptService],
  exports: [WorkspaceService, TranscriptService],
})
export class WorkspaceModule {}
