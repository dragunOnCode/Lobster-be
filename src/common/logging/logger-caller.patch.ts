import { Logger } from '@nestjs/common';
import * as path from 'path';

type LoggerMethod = (...optionalParams: unknown[]) => void;

const patchedFlag = Symbol.for('lobster.logger.caller.patched');

function getCallerLocation(): string | undefined {
  const stack = new Error().stack;
  if (!stack) {
    return undefined;
  }

  const lines = stack.split('\n').slice(1);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('at ')) {
      continue;
    }
    if (
      line.includes('logger-caller.patch.ts') ||
      line.includes('@nestjs/common') ||
      line.includes('node:internal') ||
      line.includes('(internal/')
    ) {
      continue;
    }

    const withFn = line.match(/\((.*):(\d+):(\d+)\)$/);
    const withoutFn = line.match(/at (.*):(\d+):(\d+)$/);
    const match = withFn ?? withoutFn;
    if (!match) {
      continue;
    }

    const filePath = match[1];
    const lineNumber = match[2];
    const fileName = path.basename(filePath);
    return `${fileName}:${lineNumber}`;
  }
  return undefined;
}

function patchMethod(methodName: keyof Logger): void {
  const proto = Logger.prototype as unknown as Record<string, LoggerMethod>;
  const original = proto[methodName as string];
  if (typeof original !== 'function') {
    return;
  }

  proto[methodName as string] = function patchedLoggerMethod(...args: unknown[]): void {
    const location = getCallerLocation();
    if (!location || args.length === 0 || typeof args[0] !== 'string') {
      return original.apply(this, args);
    }
    const nextArgs = [...args];
    nextArgs[0] = `[${location}] ${args[0]}`;
    return original.apply(this, nextArgs);
  };
}

export function patchNestLoggerWithCaller(): void {
  const proto = Logger.prototype as unknown as Record<string | symbol, unknown>;
  if (proto[patchedFlag]) {
    return;
  }
  proto[patchedFlag] = true;

  patchMethod('log');
  patchMethod('error');
  patchMethod('warn');
  patchMethod('debug');
  patchMethod('verbose');
}

