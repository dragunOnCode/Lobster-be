import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { MemoryModule } from '../memory/memory.module';
import { AgentService } from './services/agent.service';
import { AgentConfigService } from './services/agent-config.service';
import { CliRunnerService } from './services/cli-runner.service';
import { DecisionEngineService } from './services/decision-engine.service';

@Module({
  imports: [HttpModule, ConfigModule, MemoryModule],
  providers: [CliRunnerService, AgentService, AgentConfigService, DecisionEngineService],
  exports: [AgentConfigService, AgentService, CliRunnerService, DecisionEngineService],
})
export class AgentsModule {}
