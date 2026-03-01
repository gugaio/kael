import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { MessageRole, SessionEntry, SessionMessage } from "../types.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";

type SessionIndex = Record<string, SessionEntry>;

export class SessionStore {
  private readonly sessionsDir: string;
  private readonly transcriptsDir: string;
  private readonly indexPath: string;

  constructor(dataDir: string) {
    this.sessionsDir = path.join(dataDir, "sessions");
    this.transcriptsDir = path.join(this.sessionsDir, "transcripts");
    this.indexPath = path.join(this.sessionsDir, "index.json");
  }

  async init(): Promise<void> {
    await ensureDir(this.transcriptsDir);
    const existing = await readJsonFile<SessionIndex>(this.indexPath, {});
    await writeJsonFile(this.indexPath, existing);
  }

  async appendMessage(sessionKey: string, role: MessageRole, content: string): Promise<SessionMessage> {
    const entry = await this.getOrCreateSession(sessionKey);
    const now = new Date().toISOString();
    const message: SessionMessage = {
      id: crypto.randomUUID(),
      sessionKey,
      role,
      content,
      createdAt: now,
    };

    await fs.appendFile(entry.transcriptPath, JSON.stringify(message) + "\n", "utf-8");
    const nextUserAssistantCount =
      role === "user" || role === "assistant" ? (entry.userAssistantCount ?? 0) + 1 : (entry.userAssistantCount ?? 0);
    await this.touchSession(
      sessionKey,
      {
        ...entry,
        userAssistantCount: nextUserAssistantCount,
      },
      now,
    );
    return message;
  }

  async getMessages(sessionKey: string, limit = 50): Promise<SessionMessage[]> {
    const index = await this.readIndex();
    const entry = index[sessionKey];
    if (!entry) {
      return [];
    }

    const lines = await this.readTranscriptLines(entry.transcriptPath, limit);
    const messages: SessionMessage[] = lines
      .map((line) => {
        try {
          return JSON.parse(line) as SessionMessage;
        } catch {
          return null;
        }
      })
      .filter((message): message is SessionMessage => Boolean(message));

    return messages;
  }

  async getCompactionWatermark(sessionKey: string): Promise<{
    userAssistantCount: number;
    lastCompactionUserAssistantCount: number | null;
    lastCompactionAt: string | null;
  }> {
    const index = await this.readIndex();
    const entry = index[sessionKey];
    if (!entry) {
      return {
        userAssistantCount: 0,
        lastCompactionUserAssistantCount: null,
        lastCompactionAt: null,
      };
    }

    return {
      userAssistantCount: entry.userAssistantCount ?? 0,
      lastCompactionUserAssistantCount: entry.lastCompactionUserAssistantCount ?? null,
      lastCompactionAt: entry.lastCompactionAt ?? null,
    };
  }

  async markCompaction(sessionKey: string): Promise<void> {
    const index = await this.readIndex();
    const entry = index[sessionKey];
    if (!entry) {
      return;
    }
    const now = new Date().toISOString();
    index[sessionKey] = {
      ...entry,
      updatedAt: now,
      lastCompactionAt: now,
      lastCompactionUserAssistantCount: entry.userAssistantCount ?? 0,
    };
    await writeJsonFile(this.indexPath, index);
  }

  async resetSession(sessionKey: string): Promise<SessionEntry> {
    const index = await this.readIndex();
    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const transcriptPath = path.join(this.transcriptsDir, `${sessionId}.jsonl`);

    const entry: SessionEntry = {
      sessionKey,
      sessionId,
      transcriptPath,
      createdAt: now,
      updatedAt: now,
      userAssistantCount: 0,
    };

    await ensureDir(path.dirname(transcriptPath));
    await fs.writeFile(transcriptPath, "", "utf-8");
    index[sessionKey] = entry;
    await writeJsonFile(this.indexPath, index);
    return entry;
  }

  async countSessions(): Promise<number> {
    const index = await this.readIndex();
    return Object.keys(index).length;
  }

  private async getOrCreateSession(sessionKey: string): Promise<SessionEntry> {
    const index = await this.readIndex();
    const existing = index[sessionKey];
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const transcriptPath = path.join(this.transcriptsDir, `${sessionId}.jsonl`);

    const entry: SessionEntry = {
      sessionKey,
      sessionId,
      transcriptPath,
      createdAt: now,
      updatedAt: now,
      userAssistantCount: 0,
    };

    index[sessionKey] = entry;
    await ensureDir(path.dirname(transcriptPath));
    await fs.writeFile(transcriptPath, "", "utf-8");
    await writeJsonFile(this.indexPath, index);
    return entry;
  }

  private async touchSession(sessionKey: string, entry: SessionEntry, updatedAt: string): Promise<void> {
    const index = await this.readIndex();
    index[sessionKey] = { ...entry, updatedAt };
    await writeJsonFile(this.indexPath, index);
  }

  private async readIndex(): Promise<SessionIndex> {
    return readJsonFile<SessionIndex>(this.indexPath, {});
  }

  private async readTranscriptLines(transcriptPath: string, limit: number): Promise<string[]> {
    if (limit <= 0) {
      const raw = await fs.readFile(transcriptPath, "utf-8").catch(() => "");
      if (!raw.trim()) {
        return [];
      }
      return raw.split("\n").filter(Boolean);
    }

    const handle = await fs.open(transcriptPath, "r").catch(() => null);
    if (!handle) {
      return [];
    }
    try {
      const stat = await handle.stat();
      if (stat.size <= 0) {
        return [];
      }
      const chunkSize = 64 * 1024;
      let position = stat.size;
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      while (position > 0) {
        const readSize = Math.min(chunkSize, position);
        position -= readSize;
        const buffer = Buffer.allocUnsafe(readSize);
        const { bytesRead } = await handle.read(buffer, 0, readSize, position);
        if (bytesRead <= 0) {
          break;
        }
        const chunk = bytesRead === readSize ? buffer : buffer.subarray(0, bytesRead);
        chunks.unshift(chunk);
        totalBytes += chunk.length;

        const text = Buffer.concat(chunks, totalBytes).toString("utf-8");
        const lines = text.split("\n").filter(Boolean);
        if (lines.length >= limit || position === 0) {
          return lines.slice(-limit);
        }
      }
      return [];
    } finally {
      await handle.close();
    }
  }
}
