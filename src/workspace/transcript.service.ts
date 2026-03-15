import { Injectable } from '@nestjs/common';
import { TranscriptEvent, WorkspaceService } from './workspace.service';

@Injectable()
export class TranscriptService {
  constructor(private readonly workspaceService: WorkspaceService) {}

  async appendEvent(sessionId: string, event: TranscriptEvent): Promise<void> {
    await this.workspaceService.appendTranscript(sessionId, event);
  }

  async readEvents(sessionId: string): Promise<TranscriptEvent[]> {
    return this.workspaceService.readTranscript(sessionId);
  }

  async replaceEvents(sessionId: string, events: TranscriptEvent[]): Promise<void> {
    await this.workspaceService.replaceTranscript(sessionId, events);
  }
}
