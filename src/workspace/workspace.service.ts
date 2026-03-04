import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface TranscriptEvent {
  type: string;
  timestamp?: string;
  [key: string]: unknown;
}

@Injectable()
export class WorkspaceService implements OnModuleInit {
  private readonly workspaceRoot: string;

  constructor(private readonly configService: ConfigService) {
    this.workspaceRoot = this.configService.getOrThrow<string>('WORKSPACE_ROOT');
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.workspaceRoot, { recursive: true });
  }

  getSessionRoot(sessionId: string): string {
    return path.join(this.workspaceRoot, sessionId);
  }

  async initializeSession(sessionId: string): Promise<void> {
    const sessionRoot = this.getSessionRoot(sessionId);
    await fs.mkdir(path.join(sessionRoot, 'code'), { recursive: true });
    await fs.mkdir(path.join(sessionRoot, 'docs'), { recursive: true });

    const metadataPath = path.join(sessionRoot, 'metadata.json');
    const transcriptPath = path.join(sessionRoot, 'transcripts.jsonl');

    const metadataExists = await this.fileExists(metadataPath);
    if (!metadataExists) {
      const metadata = {
        sessionId,
        createdAt: new Date().toISOString(),
        version: '1.0.0',
        agents: [],
        fileCount: 0,
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    }

    const transcriptExists = await this.fileExists(transcriptPath);
    if (!transcriptExists) {
      await fs.writeFile(transcriptPath, '', 'utf-8');
      await this.appendTranscript(sessionId, {
        type: 'session_created',
        sessionId,
      });
    }
  }

  async listSessions(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.workspaceRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && entry.name !== '.gitkeep')
        .map((entry) => entry.name);
    } catch (error) {
      return [];
    }
  }

  async saveCodeFile(sessionId: string, filePath: string, content: string, author: string): Promise<void> {
    const fullPath = path.join(this.getSessionRoot(sessionId), 'code', filePath);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');

    await this.appendTranscript(sessionId, {
      type: 'file_created',
      path: filePath,
      author,
      language: this.detectLanguage(filePath),
      linesOfCode: content.split('\n').length,
    });
  }

  async appendTranscript(sessionId: string, event: TranscriptEvent): Promise<void> {
    const transcriptPath = path.join(this.getSessionRoot(sessionId), 'transcripts.jsonl');
    const entry = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    await fs.appendFile(transcriptPath, `${JSON.stringify(entry)}\n`, 'utf-8');
  }

  async readTranscript(sessionId: string): Promise<TranscriptEvent[]> {
    const transcriptPath = path.join(this.getSessionRoot(sessionId), 'transcripts.jsonl');
    const content = await fs.readFile(transcriptPath, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as TranscriptEvent);
  }

  async replaceTranscript(sessionId: string, events: TranscriptEvent[]): Promise<void> {
    await this.initializeSession(sessionId);
    const transcriptPath = path.join(this.getSessionRoot(sessionId), 'transcripts.jsonl');
    const content = events
      .map((event) =>
        JSON.stringify({
          ...event,
          timestamp: event.timestamp ?? new Date().toISOString(),
        }),
      )
      .join('\n');

    await fs.writeFile(transcriptPath, content.length > 0 ? `${content}\n` : '', 'utf-8');
  }

  private detectLanguage(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.js': 'javascript',
      '.vue': 'vue',
      '.py': 'python',
      '.java': 'java',
      '.md': 'markdown',
      '.json': 'json',
    };
    return languageMap[extension] ?? 'text';
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
