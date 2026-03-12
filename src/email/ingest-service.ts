import { kaelLogger } from "../infra/logger.js";
import type { ChatService } from "../chat/service.js";
import type { EmailProvider, EmailSender, InboundEmailMessage } from "./types.js";
import type { EmailIngestDedupeStore } from "./ingest-dedupe-store.js";

export type EmailIngestRuntimeTelemetry = {
  polls: number;
  messagesSeen: number;
  processed: number;
  duplicateSkipped: number;
  inFlightSkipped: number;
  selfSkipped: number;
  lastPollAt?: string;
};

export class EmailIngestService {
  private pollInFlight: Promise<{ processed: number; skipped?: boolean }> | null = null;
  private readonly telemetry = {
    polls: 0,
    messagesSeen: 0,
    processed: 0,
    duplicateSkipped: 0,
    inFlightSkipped: 0,
    selfSkipped: 0,
    lastPollAt: undefined as string | undefined,
  };

  constructor(
    private readonly provider: EmailProvider,
    private readonly chat: ChatService,
    private readonly sender?: EmailSender,
    private readonly dedupe?: EmailIngestDedupeStore,
    private readonly selfAddress?: string,
  ) {}

  async init(): Promise<void> {
    await this.provider.init();
    if (this.dedupe) {
      await this.dedupe.init();
    }
  }

  async pollNow(): Promise<{ processed: number; skipped?: boolean }> {
    if (this.pollInFlight) {
      return { processed: 0, skipped: true };
    }
    const run = this.pollNowInternal();
    this.pollInFlight = run;
    try {
      return await run;
    } finally {
      this.pollInFlight = null;
    }
  }

  getRuntimeTelemetrySnapshot(): EmailIngestRuntimeTelemetry {
    return {
      polls: this.telemetry.polls,
      messagesSeen: this.telemetry.messagesSeen,
      processed: this.telemetry.processed,
      duplicateSkipped: this.telemetry.duplicateSkipped,
      inFlightSkipped: this.telemetry.inFlightSkipped,
      selfSkipped: this.telemetry.selfSkipped,
      ...(this.telemetry.lastPollAt ? { lastPollAt: this.telemetry.lastPollAt } : {}),
    };
  }

  private async pollNowInternal(): Promise<{ processed: number; skippedDuplicates?: number }> {
    const messages = await this.provider.poll();
    this.telemetry.polls += 1;
    this.telemetry.messagesSeen += messages.length;
    this.telemetry.lastPollAt = new Date().toISOString();
    let processed = 0;
    let skippedDuplicates = 0;
    for (const message of messages) {
      const dedupeKey = buildEmailDedupeKey("gmail_pop3", message.id);
      const claimResult = this.dedupe ? await this.dedupe.claim(dedupeKey) : "claimed";
      if (claimResult !== "claimed") {
        skippedDuplicates += 1;
        if (claimResult === "duplicate") {
          this.telemetry.duplicateSkipped += 1;
        } else {
          this.telemetry.inFlightSkipped += 1;
        }
        kaelLogger.info("email.ingest.duplicate_skipped", {
          emailId: message.id,
          reason: claimResult,
        });
        continue;
      }
      try {
        const handled = await this.processSingleEmail(message);
        if (this.dedupe) {
          await this.dedupe.markProcessed(dedupeKey);
        }
        if (handled) {
          processed += 1;
          this.telemetry.processed += 1;
        }
      } finally {
        if (this.dedupe) {
          await this.dedupe.release(dedupeKey);
        }
      }
    }
    return {
      processed,
      ...(skippedDuplicates > 0 ? { skippedDuplicates } : {}),
    };
  }

  private async processSingleEmail(message: InboundEmailMessage): Promise<boolean> {
    if (isSelfEmail(message, this.selfAddress)) {
      this.telemetry.selfSkipped += 1;
      kaelLogger.info("email.ingest.self_skipped", {
        emailId: message.id,
        from: message.fromEmail ?? message.from,
        selfAddress: this.selfAddress ?? null,
        subject: message.subject,
      });
      return false;
    }
    const sessionKey = buildEmailSessionKey(message.fromEmail ?? message.from);
    const safeBody = sanitizeEmailBodyForAgent(message.body);
    const chatMessage = [
      "[email]",
      `from: ${message.from}`,
      `subject: ${message.subject}`,
      message.date ? `date: ${message.date}` : "",
      "",
      safeBody,
    ]
      .filter(Boolean)
      .join("\n");
    const turn = await this.chat.handleMessage({
      sessionKey,
      message: chatMessage,
      attachments: message.attachments,
      source: "email",
      requestId: `email:${message.id}`,
    });
    if (this.sender) {
      await this.sender.sendReply({
        original: message,
        replyText: turn.reply,
        attachments: (turn.artifacts ?? []).map((item) => ({
          kind: "image",
          dataBase64: item.dataBase64,
          mimeType: item.mimeType,
          fileName: item.fileName,
        })),
      });
      kaelLogger.info("email.reply.sent", {
        emailId: message.id,
        to: message.fromEmail ?? message.from,
        sessionKey,
      });
    }
    kaelLogger.info("email.ingest.processed", {
      emailId: message.id,
      sessionKey,
      from: message.fromEmail ?? message.from,
      subject: message.subject,
    });
    return true;
  }
}

function sanitizeEmailBodyForAgent(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let insideBase64Section = false;
  let removedBase64Lines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    if (!insideBase64Section && lower.startsWith("content-transfer-encoding:") && lower.includes("base64")) {
      insideBase64Section = true;
      out.push(line);
      continue;
    }
    if (insideBase64Section) {
      if (trimmed.startsWith("--")) {
        insideBase64Section = false;
        out.push(`[[base64_omitted_lines:${removedBase64Lines}]]`);
        removedBase64Lines = 0;
        out.push(line);
        continue;
      }
      if (trimmed && /^[A-Za-z0-9+/=]+$/.test(trimmed)) {
        removedBase64Lines += 1;
        continue;
      }
      out.push(line);
      continue;
    }

    // Evita blocos inline data URL gigantes no corpo.
    const replacedDataUrl = line.replace(
      /data:(?:image|audio)\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g,
      "[[base64_data_url_omitted]]",
    );
    // Evita linhas base64 longas fora de bloco MIME (caso comum de corpo colado).
    if (replacedDataUrl.trim().length >= 160 && /^[A-Za-z0-9+/=]+$/.test(replacedDataUrl.trim())) {
      out.push("[[base64_line_omitted]]");
      continue;
    }
    out.push(replacedDataUrl);
  }
  if (insideBase64Section) {
    out.push(`[[base64_omitted_lines:${removedBase64Lines}]]`);
  }
  return out.join("\n").trim();
}

function buildEmailSessionKey(fromValue: string): string {
  const normalized = fromValue.trim().toLowerCase();
  const safe = normalized.replace(/[^a-z0-9._@-]+/g, "-").slice(0, 120) || "unknown";
  return `email:gmail:${safe}`;
}

function buildEmailDedupeKey(provider: string, messageId: string): string {
  const safeProvider = provider.trim().toLowerCase() || "unknown";
  const safeMessageId = messageId.trim();
  return `${safeProvider}:${safeMessageId}`;
}

function isSelfEmail(message: InboundEmailMessage, selfAddress: string | undefined): boolean {
  const own = normalizeEmailAddress(selfAddress);
  if (!own) {
    return false;
  }
  const from = normalizeEmailAddress(message.fromEmail ?? message.from);
  return from === own;
}

function normalizeEmailAddress(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }
  const bracketMatch = raw.match(/<([^>]+)>/);
  const address = bracketMatch?.[1]?.trim() || raw;
  return address.toLowerCase();
}
