import path from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";
import { Pop3Client } from "./pop3-client.js";
import type { EmailProvider, InboundEmailAttachment, InboundEmailMessage } from "./types.js";

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
const MAX_ATTACHMENTS_PER_EMAIL = 3;
const MAX_ATTACHMENT_BYTES = 8_000_000;

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
        const retr = await this.mustOk(await client.command(`RETR ${item.index}`, true), "RETR");
        const parsed = parseRetrResponse(retr.lines);
        messages.push({
          id: item.uid,
          from: parsed.from,
          fromEmail: parsed.fromEmail,
          subject: parsed.subject,
          date: parsed.date,
          body: parsed.body,
          attachments: parsed.attachments,
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

export function parseRetrResponse(lines: string[]): {
  from: string;
  fromEmail?: string;
  subject: string;
  date?: string;
  body: string;
  attachments: InboundEmailAttachment[];
} {
  const raw = lines.join("\n");
  const split = splitHeaderBody(raw);
  const headers = parseHeaders(split.headerLines);
  const from = headers.from || "(remetente desconhecido)";
  const fromEmail = extractEmail(from);
  const root = parseMimeEntity(headers, split.body);
  const textBodies = collectTextBodies(root);
  const attachments = collectAttachments(root).slice(0, MAX_ATTACHMENTS_PER_EMAIL);
  const body = textBodies.find((item) => item.trim()) ?? split.body.trim();
  return {
    from,
    fromEmail: fromEmail ?? undefined,
    subject: headers.subject || "(sem assunto)",
    date: headers.date || undefined,
    body,
    attachments,
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

type MimeEntity = {
  headers: Record<string, string>;
  body: string;
  parts: MimeEntity[];
};

function splitHeaderBody(raw: string): { headerLines: string[]; body: string } {
  const match = raw.match(/\r?\n\r?\n/);
  if (!match || match.index == null) {
    return { headerLines: raw.split(/\r?\n/), body: "" };
  }
  const boundary = match.index;
  const headerRaw = raw.slice(0, boundary);
  const body = raw.slice(boundary + match[0].length);
  return { headerLines: headerRaw.split(/\r?\n/), body };
}

function parseMimeEntity(headers: Record<string, string>, body: string): MimeEntity {
  const contentType = parseContentType(headers["content-type"]);
  if (contentType.boundary) {
    const partsRaw = splitMultipartBody(body, contentType.boundary);
    const parts = partsRaw
      .map((partRaw) => {
        const split = splitHeaderBody(partRaw);
        const partHeaders = parseHeaders(split.headerLines);
        return parseMimeEntity(partHeaders, split.body);
      })
      .filter((item) => item.body.trim().length > 0 || item.parts.length > 0);
    return { headers, body, parts };
  }
  return { headers, body, parts: [] };
}

function splitMultipartBody(body: string, boundary: string): string[] {
  const normalizedBoundary = `--${boundary}`;
  const closeBoundary = `--${boundary}--`;
  const lines = body.split(/\r?\n/);
  const parts: string[] = [];
  let collecting = false;
  let current: string[] = [];
  for (const line of lines) {
    if (line === closeBoundary) {
      if (current.length > 0) {
        parts.push(current.join("\n").trim());
      }
      break;
    }
    if (line === normalizedBoundary) {
      if (collecting && current.length > 0) {
        parts.push(current.join("\n").trim());
      }
      collecting = true;
      current = [];
      continue;
    }
    if (collecting) {
      current.push(line);
    }
  }
  return parts;
}

function parseContentType(value: string | undefined): {
  mime: string;
  boundary?: string;
  name?: string;
} {
  const raw = (value ?? "").trim();
  if (!raw) {
    return { mime: "text/plain" };
  }
  const [mimePart, ...params] = raw.split(";").map((item) => item.trim());
  const out: { mime: string; boundary?: string; name?: string } = {
    mime: mimePart.toLowerCase() || "text/plain",
  };
  for (const param of params) {
    const idx = param.indexOf("=");
    if (idx <= 0) continue;
    const key = param.slice(0, idx).trim().toLowerCase();
    const valueRaw = param.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key === "boundary" && valueRaw) out.boundary = valueRaw;
    if (key === "name" && valueRaw) out.name = valueRaw;
  }
  return out;
}

function parseContentDisposition(value: string | undefined): { type: string; filename?: string } {
  const raw = (value ?? "").trim();
  if (!raw) {
    return { type: "inline" };
  }
  const [typePart, ...params] = raw.split(";").map((item) => item.trim());
  const out: { type: string; filename?: string } = { type: typePart.toLowerCase() || "inline" };
  for (const param of params) {
    const idx = param.indexOf("=");
    if (idx <= 0) continue;
    const key = param.slice(0, idx).trim().toLowerCase();
    const valueRaw = param.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key === "filename" && valueRaw) out.filename = valueRaw;
  }
  return out;
}

function decodeQuotedPrintable(input: string): string {
  const soft = input.replace(/=\r?\n/g, "");
  return soft.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => {
    return String.fromCharCode(Number.parseInt(hex, 16));
  });
}

function decodeBody(entity: MimeEntity): string {
  const encoding = (entity.headers["content-transfer-encoding"] ?? "").trim().toLowerCase();
  const rawBody = entity.body.trim();
  if (!rawBody) {
    return "";
  }
  if (encoding === "base64") {
    try {
      return Buffer.from(rawBody.replace(/\s+/g, ""), "base64").toString("utf-8");
    } catch {
      return "";
    }
  }
  if (encoding === "quoted-printable") {
    return decodeQuotedPrintable(rawBody);
  }
  return rawBody;
}

function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectTextBodies(entity: MimeEntity): string[] {
  if (entity.parts.length > 0) {
    return entity.parts.flatMap((part) => collectTextBodies(part));
  }
  const contentType = parseContentType(entity.headers["content-type"]);
  const disposition = parseContentDisposition(entity.headers["content-disposition"]);
  if (disposition.type === "attachment") {
    return [];
  }
  const text = decodeBody(entity);
  if (!text) return [];
  if (contentType.mime === "text/html") {
    const stripped = stripHtml(text);
    return stripped ? [stripped] : [];
  }
  if (contentType.mime === "text/plain") {
    return [text.trim()];
  }
  return [];
}

function toAttachmentKind(mime: string): "image" | "audio" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

function collectAttachments(entity: MimeEntity): InboundEmailAttachment[] {
  if (entity.parts.length > 0) {
    return entity.parts.flatMap((part) => collectAttachments(part));
  }
  const contentType = parseContentType(entity.headers["content-type"]);
  const disposition = parseContentDisposition(entity.headers["content-disposition"]);
  const kind = toAttachmentKind(contentType.mime);
  if (!kind) {
    return [];
  }
  const isAttachment = disposition.type === "attachment" || Boolean(disposition.filename || contentType.name);
  if (!isAttachment) {
    return [];
  }
  const normalized = entity.body.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    return [];
  }
  const decodedBytes = estimateBase64DecodedBytes(normalized);
  if (decodedBytes <= 0 || decodedBytes > MAX_ATTACHMENT_BYTES) {
    return [];
  }
  return [
    {
      kind,
      dataBase64: normalized,
      mimeType: contentType.mime,
      fileName: disposition.filename || contentType.name,
    },
  ];
}

function estimateBase64DecodedBytes(dataBase64: string): number {
  const padding = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
  return Math.floor((dataBase64.length * 3) / 4) - padding;
}
