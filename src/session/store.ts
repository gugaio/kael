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
    await this.touchSession(sessionKey, entry, now);
    return message;
  }

  async getMessages(sessionKey: string, limit = 50): Promise<SessionMessage[]> {
    const index = await this.readIndex();
    const entry = index[sessionKey];
    if (!entry) {
      return [];
    }

    const raw = await fs.readFile(entry.transcriptPath, "utf-8").catch(() => "");
    if (!raw.trim()) {
      return [];
    }

    const lines = raw.split("\n").filter(Boolean);
    const messages: SessionMessage[] = lines
      .map((line) => {
        try {
          return JSON.parse(line) as SessionMessage;
        } catch {
          return null;
        }
      })
      .filter((message): message is SessionMessage => Boolean(message));

    return limit > 0 ? messages.slice(-limit) : messages;
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
}
