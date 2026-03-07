import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { inspect } from 'util';

interface FileConsoleLoggerOptions {
  enabled: boolean;
  logDir: string;
  filePrefix?: string;
  maxSizeMb?: number;
  logLevels?: LogLevel[];
}

export class FileConsoleLogger extends ConsoleLogger {
  private readonly fileEnabled: boolean;
  private readonly logDir: string;
  private readonly filePrefix: string;
  private readonly maxSizeBytes: number;
  private currentDate = '';
  private currentFileIndex = 0;
  private currentFileSize = 0;
  private currentFilePath = '';
  private fileStream: fs.WriteStream | null = null;

  constructor(options: FileConsoleLoggerOptions) {
    super('App', {
      logLevels: options.logLevels,
      timestamp: true,
    });
    this.fileEnabled = options.enabled;
    this.logDir = options.logDir;
    this.filePrefix = options.filePrefix ?? 'application';
    this.maxSizeBytes = this.resolveMaxSizeBytes(options.maxSizeMb);
    this.ensureFileStream(this.getDateStamp(new Date()));
  }

  override log(message: unknown, context?: string): void {
    super.log(message, context);
    this.writeToFile('log', message, context);
  }

  override error(message: unknown, trace?: string, context?: string): void {
    super.error(message, trace, context);
    this.writeToFile('error', message, context, trace);
  }

  override warn(message: unknown, context?: string): void {
    super.warn(message, context);
    this.writeToFile('warn', message, context);
  }

  override debug(message: unknown, context?: string): void {
    super.debug(message, context);
    this.writeToFile('debug', message, context);
  }

  override verbose(message: unknown, context?: string): void {
    super.verbose(message, context);
    this.writeToFile('verbose', message, context);
  }

  private writeToFile(level: LogLevel, message: unknown, context?: string, trace?: string): void {
    if (!this.fileEnabled) {
      return;
    }
    const now = new Date();
    const dateStamp = this.getDateStamp(now);
    this.ensureFileStream(dateStamp);
    const ctx = context ?? 'App';
    const content = this.formatMessageText(message);
    const timestamp = now.toISOString();
    const line = `${timestamp} ${level.toUpperCase()} [${ctx}] ${content}`;
    const output = trace && trace.trim().length > 0 ? `${line}\n${trace}` : line;
    const entry = `${output}\n`;
    const entryBytes = Buffer.byteLength(entry, 'utf8');

    if (this.currentFileSize + entryBytes > this.maxSizeBytes) {
      this.ensureFileStream(dateStamp, true);
    }

    if (!this.fileStream) {
      return;
    }
    this.fileStream.write(entry);
    this.currentFileSize += entryBytes;
  }

  private ensureFileStream(dateStamp: string, forceRotate = false): void {
    if (!this.fileEnabled) {
      return;
    }
    if (this.fileStream && this.currentDate === dateStamp && !forceRotate) {
      return;
    }

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = null;
    }

    const target = this.resolveTargetFile(dateStamp, forceRotate);
    this.fileStream = fs.createWriteStream(target.filePath, {
      flags: 'a',
      encoding: 'utf-8',
    });
    this.currentDate = dateStamp;
    this.currentFileIndex = target.index;
    this.currentFilePath = target.filePath;
    this.currentFileSize = target.size;
  }

  private getDateStamp(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private resolveTargetFile(dateStamp: string, forceRotate: boolean): { index: number; filePath: string; size: number } {
    const files = this.listDateLogFiles(dateStamp);
    if (files.length === 0) {
      const filePath = this.buildFilePath(dateStamp, 0);
      const size = this.getFileSize(filePath);
      return { index: 0, filePath, size };
    }

    const sorted = files.sort((left, right) => left.index - right.index);
    const latest = sorted[sorted.length - 1];

    if (forceRotate) {
      const nextIndex = latest.index + 1;
      return {
        index: nextIndex,
        filePath: this.buildFilePath(dateStamp, nextIndex),
        size: 0,
      };
    }

    if (latest.size < this.maxSizeBytes) {
      return latest;
    }

    const nextIndex = latest.index + 1;
    return {
      index: nextIndex,
      filePath: this.buildFilePath(dateStamp, nextIndex),
      size: 0,
    };
  }

  private listDateLogFiles(dateStamp: string): Array<{ index: number; filePath: string; size: number }> {
    if (!fs.existsSync(this.logDir)) {
      return [];
    }
    const escapedPrefix = this.escapeRegExp(this.filePrefix);
    const pattern = new RegExp(`^${escapedPrefix}-${dateStamp}(?:-(\\d+))?\\.log$`);
    const files: Array<{ index: number; filePath: string; size: number }> = [];

    for (const entry of fs.readdirSync(this.logDir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      const match = entry.name.match(pattern);
      if (!match) {
        continue;
      }
      const index = match[1] ? Number(match[1]) : 0;
      const filePath = path.resolve(this.logDir, entry.name);
      files.push({
        index: Number.isFinite(index) ? index : 0,
        filePath,
        size: this.getFileSize(filePath),
      });
    }

    return files;
  }

  private buildFilePath(dateStamp: string, index: number): string {
    const suffix = index > 0 ? `-${index}` : '';
    return path.resolve(this.logDir, `${this.filePrefix}-${dateStamp}${suffix}.log`);
  }

  private getFileSize(filePath: string): number {
    if (!fs.existsSync(filePath)) {
      return 0;
    }
    try {
      return fs.statSync(filePath).size;
    } catch {
      return 0;
    }
  }

  private resolveMaxSizeBytes(maxSizeMb: number | undefined): number {
    const defaultMaxSizeMb = 10;
    const parsed = typeof maxSizeMb === 'number' && Number.isFinite(maxSizeMb) && maxSizeMb > 0 ? maxSizeMb : defaultMaxSizeMb;
    return Math.floor(parsed * 1024 * 1024);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private formatMessageText(message: unknown): string {
    if (typeof message === 'string') {
      return message;
    }
    if (message instanceof Error) {
      return message.stack || message.message;
    }
    return inspect(message, { depth: 6, breakLength: 120 });
  }
}

export function resolveLogLevels(level: string | undefined): LogLevel[] {
  const normalized = (level ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'verbose':
      return ['log', 'error', 'warn', 'debug', 'verbose'];
    case 'debug':
      return ['log', 'error', 'warn', 'debug'];
    case 'warn':
      return ['error', 'warn'];
    case 'error':
      return ['error'];
    case 'log':
    default:
      return ['log', 'error', 'warn'];
  }
}
