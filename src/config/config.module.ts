import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { GatewayModule } from '../gateway/gateway.module';
import { ConfigWatcherService } from './config-watcher.service';

@Module({
  imports: [AgentsModule, GatewayModule],
  providers: [ConfigWatcherService],
  exports: [ConfigWatcherService],
})
export class LobsterConfigModule {}
