import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{ method: string; url: string }>();
    const { method, url } = request;
    const startMs = Date.now();

    return next.handle().pipe(
      tap(() => {
        const elapsedMs = Date.now() - startMs;
        this.logger.log(`${method} ${url} — ${elapsedMs}ms`);
      }),
    );
  }
}
