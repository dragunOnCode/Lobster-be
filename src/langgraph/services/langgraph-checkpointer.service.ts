import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseCheckpointSaver, MemorySaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

type CheckpointerDriver = 'auto' | 'memory' | 'postgres';

@Injectable()
export class LangGraphCheckpointerService {
  private readonly logger = new Logger(LangGraphCheckpointerService.name);
  private checkpointerPromise?: Promise<BaseCheckpointSaver>;

  constructor(private readonly configService: ConfigService) {}

  getCheckpointer(): Promise<BaseCheckpointSaver> {
    if (!this.checkpointerPromise) {
      this.checkpointerPromise = this.createCheckpointer();
    }
    return this.checkpointerPromise;
  }

  private async createCheckpointer(): Promise<BaseCheckpointSaver> {
    const driver = this.getDriver();
    if (driver === 'memory') {
      this.logger.log('LangGraph checkpointer driver=memory');
      return new MemorySaver();
    }

    const connString = this.getConnectionString();
    if (!connString) {
      if (driver === 'postgres') {
        throw new Error('LANGGRAPH_CHECKPOINTER_DRIVER=postgres but no Postgres connection configuration was found');
      }
      this.logger.warn('LangGraph checkpointer falling back to MemorySaver because Postgres config is incomplete');
      return new MemorySaver();
    }

    const schema = this.configService.get<string>('LANGGRAPH_CHECKPOINTER_SCHEMA') ?? 'public';
    const checkpointer = PostgresSaver.fromConnString(connString, { schema });
    if ((this.configService.get<string>('LANGGRAPH_CHECKPOINTER_AUTO_SETUP') ?? 'true') !== 'false') {
      await checkpointer.setup();
    }

    this.logger.log(`LangGraph checkpointer driver=postgres schema=${schema}`);
    return checkpointer;
  }

  private getDriver(): CheckpointerDriver {
    const raw = (this.configService.get<string>('LANGGRAPH_CHECKPOINTER_DRIVER') ?? 'auto').toLowerCase();
    if (raw === 'memory' || raw === 'postgres') {
      return raw;
    }
    return 'auto';
  }

  private getConnectionString(): string | undefined {
    const direct = this.configService.get<string>('LANGGRAPH_CHECKPOINTER_URL');
    if (direct?.trim()) {
      return direct.trim();
    }

    const host = this.configService.get<string>('DB_HOST');
    const port = this.configService.get<string>('DB_PORT');
    const username = this.configService.get<string>('DB_USERNAME');
    const database = this.configService.get<string>('DB_DATABASE');
    if (!host || !port || !username || !database) {
      return undefined;
    }

    const password = this.configService.get<string>('DB_PASSWORD') ?? '';
    const encodedUser = encodeURIComponent(username);
    const encodedPassword = encodeURIComponent(password);
    const credentials = password ? `${encodedUser}:${encodedPassword}` : encodedUser;
    return `postgresql://${credentials}@${host}:${port}/${database}`;
  }
}
