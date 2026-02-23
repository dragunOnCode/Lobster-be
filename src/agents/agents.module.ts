import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { MemoryModule } from '../memory/memory.module';
import { VectorModule } from '../vector/vector.module';
import { AgentService } from './services/agent.service';
import { AgentConfigService } from './services/agent-config.service';
import { CliRunnerService } from './services/cli-runner.service';
import { DecisionEngineService } from './services/decision-engine.service';
import { ContextBuilderService } from './services/context-builder.service';

@Module({
  imports: [HttpModule, ConfigModule, MemoryModule, VectorModule],
  providers: [CliRunnerService, AgentService, AgentConfigService, DecisionEngineService, ContextBuilderService],
  exports: [AgentConfigService, AgentService, CliRunnerService, DecisionEngineService, ContextBuilderService],
})
export class AgentsModule {}
