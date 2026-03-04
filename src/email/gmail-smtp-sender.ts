import tls from "node:tls";
import { randomUUID } from "node:crypto";
import type { EmailSender, InboundEmailAttachment, InboundEmailMessage } from "./types.js";

type GmailSmtpSenderConfig = {
  address: string;
  appPassword: string;
  host: string;
  port: number;
  timeoutMs: number;
};

type SmtpResponse = {
  code: number;
  lines: string[];
};

export class GmailSmtpSender implements EmailSender {
  constructor(private readonly cfg: GmailSmtpSenderConfig) {}

  async sendReply(params: {
    original: InboundEmailMessage;
    replyText: string;
    attachments?: InboundEmailAttachment[];
  }): Promise<void> {
    const recipient = params.original.fromEmail?.trim();
    if (!recipient) {
      return;
    }

    const socket = tls.connect({
      host: this.cfg.host,
      port: this.cfg.port,
      servername: this.cfg.host,
      rejectUnauthorized: true,
    });
    socket.setEncoding("utf8");
    socket.setTimeout(this.cfg.timeoutMs);
    try {
      await onceEvent(socket, "secureConnect");

      await expectCode(await readResponse(socket), [220], "greeting");
      await writeLine(socket, "EHLO kael.local");
      await expectCode(await readResponse(socket), [250], "EHLO");

      await writeLine(socket, "AUTH LOGIN");
      await expectCode(await readResponse(socket), [334], "AUTH LOGIN");
      await writeLine(socket, Buffer.from(this.cfg.address, "utf8").toString("base64"));
      await expectCode(await readResponse(socket), [334], "AUTH LOGIN user");
      await writeLine(socket, Buffer.from(this.cfg.appPassword, "utf8").toString("base64"));
      await expectCode(await readResponse(socket), [235], "AUTH LOGIN pass");

      await writeLine(socket, `MAIL FROM:<${this.cfg.address}>`);
      await expectCode(await readResponse(socket), [250], "MAIL FROM");

      await writeLine(socket, `RCPT TO:<${recipient}>`);
      await expectCode(await readResponse(socket), [250, 251], "RCPT TO");

      await writeLine(socket, "DATA");
      await expectCode(await readResponse(socket), [354], "DATA");

      const subject = buildReplySubject(params.original.subject);
      const message = buildMessage({
        from: this.cfg.address,
        to: recipient,
        subject,
        body: params.replyText,
        attachments: params.attachments,
      });
      await writeRaw(socket, `${message}\r\n.\r\n`);
      await expectCode(await readResponse(socket), [250], "DATA end");

      await writeLine(socket, "QUIT");
      await readResponse(socket);
    } finally {
      if (!socket.destroyed) {
        socket.end();
      }
    }
  }
}

function buildReplySubject(original: string): string {
  const trimmed = original.trim();
  if (!trimmed) {
    return "Re: (sem assunto)";
  }
  if (/^re:/i.test(trimmed)) {
    return trimmed;
  }
  return `Re: ${trimmed}`;
}

function buildMessage(params: {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments?: InboundEmailAttachment[];
}): string {
  const safeBody = dotStuff(params.body);
  const attachments = (params.attachments ?? []).filter((item) => item.dataBase64?.trim());
  if (attachments.length === 0) {
    return [
      `From: <${params.from}>`,
      `To: <${params.to}>`,
      `Subject: ${params.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      safeBody,
    ].join("\r\n");
  }

  const boundary = `kael-mixed-${randomUUID()}`;
  const lines: string[] = [
    `From: <${params.from}>`,
    `To: <${params.to}>`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    safeBody,
  ];

  for (const attachment of attachments) {
    const mimeType = attachment.mimeType?.trim() || defaultMimeByKind(attachment.kind);
    const fileName = attachment.fileName?.trim() || defaultFileName(attachment.kind, mimeType);
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${mimeType}; name=\"${fileName}\"`);
    lines.push(`Content-Disposition: attachment; filename=\"${fileName}\"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(foldBase64ForSmtp(attachment.dataBase64));
  }

  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

function defaultMimeByKind(kind: InboundEmailAttachment["kind"]): string {
  if (kind === "audio") return "audio/ogg";
  return "image/png";
}

function defaultFileName(kind: InboundEmailAttachment["kind"], mimeType: string): string {
  const ext = mimeTypeToExt(mimeType);
  return `${kind}-${randomUUID().slice(0, 8)}.${ext}`;
}

function mimeTypeToExt(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes("jpeg")) return "jpg";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("gif")) return "gif";
  if (lower.includes("bmp")) return "bmp";
  if (lower.includes("audio/mpeg")) return "mp3";
  if (lower.includes("audio/wav")) return "wav";
  if (lower.includes("audio/mp4")) return "m4a";
  if (lower.includes("audio/flac")) return "flac";
  if (lower.includes("audio/ogg")) return "ogg";
  if (lower.includes("png")) return "png";
  return "bin";
}

function foldBase64ForSmtp(input: string): string {
  const normalized = input.replace(/\s+/g, "");
  const chunks: string[] = [];
  for (let i = 0; i < normalized.length; i += 76) {
    chunks.push(normalized.slice(i, i + 76));
  }
  return chunks.join("\r\n");
}

function dotStuff(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

async function writeLine(socket: tls.TLSSocket, line: string): Promise<void> {
  await writeRaw(socket, `${line}\r\n`);
}

async function writeRaw(socket: tls.TLSSocket, raw: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(raw, (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function readResponse(socket: tls.TLSSocket): Promise<SmtpResponse> {
  let line = await readLine(socket);
  const lines = [line];
  const code = parseCode(line);
  if (code == null) {
    throw new Error(`smtp: resposta invalida: ${line}`);
  }
  while (line.startsWith(`${String(code)}-`)) {
    line = await readLine(socket);
    lines.push(line);
  }
  return { code, lines };
}

function parseCode(line: string): number | null {
  const match = line.match(/^(\d{3})[ -]/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

const lineBuffers = new WeakMap<tls.TLSSocket, string>();

async function readLine(socket: tls.TLSSocket): Promise<string> {
  let buffer = lineBuffers.get(socket) ?? "";
  while (true) {
    const idx = buffer.indexOf("\r\n");
    if (idx >= 0) {
      const line = buffer.slice(0, idx);
      lineBuffers.set(socket, buffer.slice(idx + 2));
      return line;
    }
    const chunk = socket.read();
    if (typeof chunk === "string" && chunk.length > 0) {
      buffer += chunk;
      continue;
    }
    const next = await waitChunk(socket);
    buffer += next;
  }
}

async function waitChunk(socket: tls.TLSSocket): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const onReadable = (): void => {
      cleanup();
      const chunk = socket.read();
      resolve(typeof chunk === "string" ? chunk : "");
    };
    const onTimeout = (): void => {
      cleanup();
      reject(new Error("smtp: timeout aguardando resposta"));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("smtp: conexao encerrada"));
    };
    const cleanup = (): void => {
      socket.off("readable", onReadable);
      socket.off("timeout", onTimeout);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    socket.on("readable", onReadable);
    socket.on("timeout", onTimeout);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

async function expectCode(
  response: SmtpResponse,
  acceptedCodes: number[],
  step: string,
): Promise<void> {
  if (acceptedCodes.includes(response.code)) {
    return;
  }
  throw new Error(`smtp ${step} falhou: ${response.lines.join(" | ")}`);
}

function onceEvent(
  emitter: NodeJS.EventEmitter,
  event: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onEvent = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      emitter.off(event, onEvent);
      emitter.off("error", onError);
    };
    emitter.on(event, onEvent);
    emitter.on("error", onError);
  });
}
