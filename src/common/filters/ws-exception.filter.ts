import { ArgumentsHost, Catch, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch()
export class WsExceptionFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();

    const errorPayload = this.buildErrorPayload(exception);

    this.logger.error(
      `WS exception [client=${client.id}]: ${errorPayload.message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    client.emit('exception', errorPayload);
  }

  private buildErrorPayload(exception: unknown): { status: string; message: string; timestamp: string } {
    let message = 'Internal server error';

    if (exception instanceof WsException) {
      const error = exception.getError();
      message = typeof error === 'string' ? error : ((error as { message?: string })?.message ?? 'WebSocket error');
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    return {
      status: 'error',
      message,
      timestamp: new Date().toISOString(),
    };
  }
}
