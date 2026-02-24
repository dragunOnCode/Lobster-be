import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { patchNestLoggerWithCaller } from './common/logging/logger-caller.patch';

async function bootstrap(): Promise<void> {
  patchNestLoggerWithCaller();
  const bootstrapLogger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT);
  if (Number.isNaN(port)) {
    throw new Error('Missing or invalid env: PORT');
  }

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  await app.listen(port);
  bootstrapLogger.log(`Application listening on port ${port}`);
}

void bootstrap();
