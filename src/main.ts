import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { patchNestLoggerWithCaller } from './common/logging/logger-caller.patch';
import { FileConsoleLogger, resolveLogLevels } from './common/logging/file-console.logger';

async function bootstrap(): Promise<void> {
  patchNestLoggerWithCaller();
  const logLevel = process.env.LOG_LEVEL;
  const logFileEnabled = (process.env.LOG_FILE_ENABLED ?? 'false').trim().toLowerCase() === 'true';
  const logDir = process.env.LOG_FILE_PATH?.trim() || './logs';
  const parsedLogFileMaxSizeMb = Number(process.env.LOG_FILE_MAX_SIZE_MB ?? '10');
  const logFileMaxSizeMb =
    Number.isFinite(parsedLogFileMaxSizeMb) && parsedLogFileMaxSizeMb > 0 ? parsedLogFileMaxSizeMb : 10;
  const appLogger = new FileConsoleLogger({
    enabled: logFileEnabled,
    logDir,
    filePrefix: 'lobster',
    maxSizeMb: logFileMaxSizeMb,
    logLevels: resolveLogLevels(logLevel),
  });

  const bootstrapLogger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(appLogger);
  const port = Number(process.env.PORT);
  if (Number.isNaN(port)) {
    throw new Error('Missing or invalid env: PORT');
  }

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  await app.listen(port);
  bootstrapLogger.log(`Application listening on port ${port}`);
  if (logFileEnabled) {
    bootstrapLogger.log(`File logging enabled, directory=${logDir}`);
  }
}

void bootstrap();
