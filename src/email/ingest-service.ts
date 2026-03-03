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
    const chatMessage = [
      "[email]",
      `from: ${message.from}`,
      `subject: ${message.subject}`,
      message.date ? `date: ${message.date}` : "",
      "",
      message.body,
    ]
      .filter(Boolean)
      .join("\n");
    const turn = await this.chat.handleMessage({
      sessionKey,
      message: chatMessage,
      requestId: `email:${message.id}`,
    });
    if (this.sender) {
      await this.sender.sendReply({
        original: message,
        replyText: turn.reply,
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

function buildEmailSessionKey(fromValue: string): string {
  const normalized = fromValue.trim().toLowerCase();
  const safe = normalized.replace(/[^a-z0-9._@-]+/g, "-").slice(0, 120) || "unknown";
  return `email:gmail:${safe}`;
}
