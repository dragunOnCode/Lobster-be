import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { LangGraphThreadDebugService } from './services/langgraph-thread-debug.service';

interface RestoreThreadBody {
  checkpointId: string;
}

@Controller('langgraph/threads')
export class LangGraphThreadsController {
  constructor(private readonly threadDebugService: LangGraphThreadDebugService) {}

  @Get(':threadId/state')
  getState(
    @Param('threadId') threadId: string,
    @Query('checkpointId') checkpointId?: string,
  ) {
    return this.threadDebugService.getThreadState(threadId, checkpointId);
  }

  @Get(':threadId/history')
  getHistory(
    @Param('threadId') threadId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.threadDebugService.getThreadHistory(threadId, limit ?? 20);
  }

  @Get(':threadId/replay')
  getReplay(
    @Param('threadId') threadId: string,
    @Query('checkpointId') checkpointId?: string,
    @Query('historyLimit', new ParseIntPipe({ optional: true })) historyLimit?: number,
    @Query('messageLimit', new ParseIntPipe({ optional: true })) messageLimit?: number,
  ) {
    return this.threadDebugService.getReplayView(threadId, {
      checkpointId,
      historyLimit,
      messageLimit,
    });
  }

  @Post(':threadId/restore')
  restore(
    @Param('threadId') threadId: string,
    @Body() body: RestoreThreadBody,
  ) {
    return this.threadDebugService.restoreThreadState(threadId, body.checkpointId);
  }
}
