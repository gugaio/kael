import path from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";
import { Pop3Client } from "./pop3-client.js";
import type { EmailProvider, InboundEmailMessage } from "./types.js";

type GmailPop3ProviderConfig = {
  address: string;
  appPassword: string;
  host: string;
  port: number;
  timeoutMs: number;
  topLines: number;
  maxMessagesPerPoll: number;
  statePath: string;
};

type GmailPop3State = {
  seenUids: string[];
};

const DEFAULT_STATE: GmailPop3State = { seenUids: [] };
const MAX_SEEN_UIDS = 10_000;

export class GmailPop3Provider implements EmailProvider {
  private state: GmailPop3State = DEFAULT_STATE;

  constructor(private readonly cfg: GmailPop3ProviderConfig) {}

  async init(): Promise<void> {
    await ensureDir(path.dirname(this.cfg.statePath));
    this.state = await readJsonFile<GmailPop3State>(this.cfg.statePath, DEFAULT_STATE);
  }

  async poll(): Promise<InboundEmailMessage[]> {
    const client = new Pop3Client(this.cfg.host, this.cfg.port, this.cfg.timeoutMs);
    const seen = new Set(this.state.seenUids);
    const newSeen = [...this.state.seenUids];
    try {
      await client.connect();
      await this.mustOk(await client.command(`USER ${this.cfg.address}`, false), "USER");
      await this.mustOk(await client.command(`PASS ${this.cfg.appPassword}`, false), "PASS");

      const uidl = await this.mustOk(await client.command("UIDL", true), "UIDL");
      const indexed = uidl.lines
        .map(parseUidlLine)
        .filter((item): item is { index: number; uid: string } => item !== null)
        .sort((a, b) => a.index - b.index);
      const unseen = indexed.filter((item) => !seen.has(item.uid)).slice(0, this.cfg.maxMessagesPerPoll);
      const messages: InboundEmailMessage[] = [];
      for (const item of unseen) {
        const top = await this.mustOk(await client.command(`TOP ${item.index} ${this.cfg.topLines}`, true), "TOP");
        const parsed = parseTopResponse(top.lines);
        messages.push({
          id: item.uid,
          from: parsed.from,
          fromEmail: parsed.fromEmail,
          subject: parsed.subject,
          date: parsed.date,
          body: parsed.body,
        });
        seen.add(item.uid);
        newSeen.push(item.uid);
      }
      await this.mustOk(await client.command("QUIT", false), "QUIT");

      this.state = {
        seenUids: newSeen.slice(-MAX_SEEN_UIDS),
      };
      await writeJsonFile(this.cfg.statePath, this.state);
      return messages;
    } finally {
      await client.close();
    }
  }

  private async mustOk(
    result: { ok: boolean; statusLine: string; lines: string[] },
    command: string,
  ): Promise<{ statusLine: string; lines: string[] }> {
    if (!result.ok) {
      throw new Error(`pop3 ${command} falhou: ${result.statusLine}`);
    }
    return {
      statusLine: result.statusLine,
      lines: result.lines,
    };
  }
}

function parseUidlLine(line: string): { index: number; uid: string } | null {
  const match = line.trim().match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  const uid = match[2].trim();
  if (!Number.isFinite(index) || index <= 0 || !uid) {
    return null;
  }
  return { index, uid };
}

function parseTopResponse(lines: string[]): {
  from: string;
  fromEmail?: string;
  subject: string;
  date?: string;
  body: string;
} {
  const separator = lines.findIndex((line) => line.trim() === "");
  const headerLines = separator >= 0 ? lines.slice(0, separator) : lines;
  const bodyLines = separator >= 0 ? lines.slice(separator + 1) : [];
  const headers = parseHeaders(headerLines);
  const from = headers.from || "(remetente desconhecido)";
  const fromEmail = extractEmail(from);
  return {
    from,
    fromEmail: fromEmail ?? undefined,
    subject: headers.subject || "(sem assunto)",
    date: headers.date || undefined,
    body: bodyLines.join("\n").trim(),
  };
}

function parseHeaders(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  let currentKey = "";
  for (const raw of lines) {
    if (raw.startsWith(" ") || raw.startsWith("\t")) {
      if (currentKey) {
        headers[currentKey] = `${headers[currentKey]} ${raw.trim()}`.trim();
      }
      continue;
    }
    const idx = raw.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = raw.slice(0, idx).trim().toLowerCase();
    const value = raw.slice(idx + 1).trim();
    headers[key] = value;
    currentKey = key;
  }
  return headers;
}

function extractEmail(value: string): string | null {
  const match = value.match(/<([^>]+)>/);
  if (match?.[1]) {
    return match[1].trim().toLowerCase();
  }
  if (value.includes("@")) {
    return value.trim().toLowerCase();
  }
  return null;
}
