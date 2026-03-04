import { kaelLogger } from "../infra/logger.js";
import type { ChatService } from "../chat/service.js";
import type { EmailProvider, EmailSender, InboundEmailMessage } from "./types.js";

export class EmailIngestService {
  private pollInFlight: Promise<{ processed: number; skipped?: boolean }> | null = null;

  constructor(
    private readonly provider: EmailProvider,
    private readonly chat: ChatService,
    private readonly sender?: EmailSender,
  ) {}

  async init(): Promise<void> {
    await this.provider.init();
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

  private async pollNowInternal(): Promise<{ processed: number }> {
    const messages = await this.provider.poll();
    for (const message of messages) {
      await this.processSingleEmail(message);
    }
    return { processed: messages.length };
  }

  private async processSingleEmail(message: InboundEmailMessage): Promise<void> {
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
