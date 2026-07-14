import WebSocket from "ws";
import type { KaelApp } from "../../app.js";
import { kaelLogger } from "../../infra/logger.js";
import type { EngineInboundAttachment } from "../../agents/types.js";

type DiscordGatewayHello = {
  op: 10;
  d: { heartbeat_interval: number };
};

type DiscordGatewayDispatch = {
  op: 0;
  t: string;
  s?: number;
  d: Record<string, unknown>;
};

type DiscordMessageAuthor = {
  id: string;
  bot?: boolean;
  username?: string;
};

type DiscordMessage = {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  author: DiscordMessageAuthor;
  mentions?: Array<{ id: string }>;
  attachments?: Array<{
    id?: string;
    filename?: string;
    content_type?: string;
    url?: string;
    size?: number;
  }>;
  type?: number;
};

const DISCORD_MEDIA_MAX_BYTES = 8_000_000;
const DISCORD_MEDIA_MAX_ATTACHMENTS = 3;

type DiscordBotConfig = {
  token: string;
  mentionOnlyInGuilds: boolean;
  allowedGuildIds: Set<string>;
  allowedChannelIds: Set<string>;
  sessionScope: "user_channel" | "channel";
};

function parseCsvSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

function loadDiscordConfigFromEnv(): DiscordBotConfig {
  const token = process.env.DISCORD_BOT_TOKEN?.trim() ?? "";
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is required");
  }
  return {
    token,
    mentionOnlyInGuilds: (process.env.DISCORD_MENTION_ONLY_IN_GUILDS ?? "true").trim().toLowerCase() !== "false",
    allowedGuildIds: parseCsvSet(process.env.DISCORD_ALLOWED_GUILD_IDS),
    allowedChannelIds: parseCsvSet(process.env.DISCORD_ALLOWED_CHANNEL_IDS),
    sessionScope:
      (process.env.DISCORD_SESSION_SCOPE?.trim().toLowerCase() === "channel" ? "channel" : "user_channel"),
  };
}

function splitDiscordMessage(text: string, maxLen = 1900): string[] {
  const trimmed = text.trim();
  if (!trimmed) return ["(sem resposta)"];
  if (trimmed.length <= maxLen) return [trimmed];
  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = rest.lastIndexOf(" ", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function buildSessionKey(
  msg: DiscordMessage,
  mode: "user_channel" | "channel",
): string {
  const guildPart = msg.guild_id ? `guild:${msg.guild_id}` : "dm";
  if (mode === "channel") {
    return `discord:${guildPart}:channel:${msg.channel_id}`;
  }
  return `discord:${guildPart}:channel:${msg.channel_id}:user:${msg.author.id}`;
}

function stripBotMentions(content: string, botUserId: string | null): string {
  let out = content;
  if (botUserId) {
    out = out.replace(new RegExp(`<@!?${botUserId}>`, "g"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

export class DiscordChatOnlyBot {
  private ws: WebSocket | null = null;
  private seq: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private botUserId: string | null = null;
  private stopping = false;
  private readonly queueBySession = new Map<string, Promise<void>>();

  constructor(
    private readonly app: KaelApp,
    private readonly cfg: DiscordBotConfig,
  ) {}

  static fromEnv(app: KaelApp): DiscordChatOnlyBot {
    return new DiscordChatOnlyBot(app, loadDiscordConfigFromEnv());
  }

  async start(): Promise<void> {
    this.stopping = false;
    const gatewayInfo = await this.discordApi<{ url: string }>("/gateway/bot", "GET");
    const gatewayUrl = `${gatewayInfo.url}?v=10&encoding=json`;
    await this.connect(gatewayUrl);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async connect(gatewayUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(gatewayUrl);
      this.ws = ws;
      let connected = false;

      ws.on("open", () => {
        kaelLogger.info("discord.gateway.connected", { gatewayUrl });
      });

      ws.on("message", (raw: unknown) => {
        try {
          const packet = JSON.parse(String(raw)) as { op: number; t?: string; s?: number; d?: unknown };
          if (typeof packet.s === "number") {
            this.seq = packet.s;
          }
          if (packet.op === 10) {
            const hello = packet as unknown as DiscordGatewayHello;
            this.startHeartbeat(hello.d.heartbeat_interval);
            this.identify();
            connected = true;
            resolve();
            return;
          }
          if (packet.op === 11) {
            return;
          }
          if (packet.op === 0) {
            void this.onDispatch(packet as unknown as DiscordGatewayDispatch);
            return;
          }
          if (packet.op === 7) {
            kaelLogger.warn("discord.gateway.reconnect_requested", {});
            void this.reconnect(gatewayUrl);
            return;
          }
        } catch (error) {
          kaelLogger.warn("discord.gateway.packet_error", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      ws.on("close", (code: number) => {
        kaelLogger.warn("discord.gateway.closed", { code });
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        if (!connected) {
          reject(new Error(`Discord gateway closed before HELLO (code=${code})`));
          return;
        }
        if (!this.stopping) {
          void this.reconnect(gatewayUrl);
        }
      });

      ws.on("error", (error: Error) => {
        kaelLogger.error("discord.gateway.error", {
          message: error.message,
        });
        if (!connected) {
          reject(error);
        }
      });
    });
  }

  private async reconnect(gatewayUrl: string): Promise<void> {
    if (this.stopping) return;
    await this.stop();
    await new Promise((r) => setTimeout(r, 1500));
    await this.connect(gatewayUrl);
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatTimer = setInterval(() => {
      this.sendGateway({ op: 1, d: this.seq });
    }, Math.max(1000, intervalMs));
  }

  private identify(): void {
    const intents =
      (1 << 0) | // GUILDS
      (1 << 9) | // GUILD_MESSAGES
      (1 << 12) | // DIRECT_MESSAGES
      (1 << 15); // MESSAGE_CONTENT
    this.sendGateway({
      op: 2,
      d: {
        token: this.cfg.token,
        intents,
        properties: {
          os: process.platform,
          browser: "kael",
          device: "kael",
        },
      },
    });
  }

  private sendGateway(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private async onDispatch(packet: DiscordGatewayDispatch): Promise<void> {
    if (packet.t === "READY") {
      const user = (packet.d.user ?? {}) as { id?: unknown };
      this.botUserId = typeof user.id === "string" ? user.id : null;
      kaelLogger.info("discord.ready", { botUserId: this.botUserId });
      return;
    }
    if (packet.t !== "MESSAGE_CREATE") return;
    const msg = packet.d as unknown as DiscordMessage;
    await this.onMessage(msg);
  }

  private async onMessage(msg: DiscordMessage): Promise<void> {
    if (!msg?.author?.id) return;
    if (msg.author.bot) return;
    if (!msg.content?.trim()) return;

    if (msg.guild_id && this.cfg.allowedGuildIds.size > 0 && !this.cfg.allowedGuildIds.has(msg.guild_id)) {
      return;
    }
    if (this.cfg.allowedChannelIds.size > 0 && !this.cfg.allowedChannelIds.has(msg.channel_id)) {
      return;
    }

    const mentioned = (msg.mentions ?? []).some((m) => m.id === this.botUserId);
    if (msg.guild_id && this.cfg.mentionOnlyInGuilds && !mentioned) {
      return;
    }

    const cleaned = stripBotMentions(msg.content, this.botUserId);
    if (!cleaned) return;

    const sessionKey = buildSessionKey(msg, this.cfg.sessionScope);
    const prev = this.queueBySession.get(sessionKey) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        await this.handleMessageQueued(msg, cleaned, sessionKey);
      })
      .finally(() => {
        if (this.queueBySession.get(sessionKey) === next) {
          this.queueBySession.delete(sessionKey);
        }
      });
    this.queueBySession.set(sessionKey, next);
  }

  private async handleMessageQueued(msg: DiscordMessage, content: string, sessionKey: string): Promise<void> {
    kaelLogger.info("discord.message.received", {
      channelId: msg.channel_id,
      guildId: msg.guild_id ?? null,
      userId: msg.author.id,
      sessionKey,
      chars: content.length,
    });

    const typingInterval = setInterval(() => {
      void this.safeSendTyping(msg.channel_id, sessionKey);
    }, 8000);
    try {
      const attachments = await this.extractInboundAttachments(msg, sessionKey);
      await this.safeSendTyping(msg.channel_id, sessionKey);
      const turn = await this.app.chat.handleMessage({
        sessionKey,
        message: content,
        attachments,
        source: "discord",
        requestId: `discord:${msg.id}`,
        allowOperationalShortcuts: false,
      });
      for (const chunk of splitDiscordMessage(turn.reply)) {
        await this.sendChannelMessage(msg.channel_id, chunk, msg.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      kaelLogger.error("discord.message.failed", {
        channelId: msg.channel_id,
        guildId: msg.guild_id ?? null,
        userId: msg.author.id,
        sessionKey,
        message,
      });
      await this.sendChannelMessage(
        msg.channel_id,
        `Falha ao processar a mensagem no Kael: ${message}`,
        msg.id,
      ).catch(() => undefined);
    } finally {
      clearInterval(typingInterval);
    }
  }

  private async sendTyping(channelId: string): Promise<void> {
    await this.discordApi(`/channels/${channelId}/typing`, "POST");
  }

  private async safeSendTyping(channelId: string, sessionKey: string): Promise<void> {
    try {
      await this.sendTyping(channelId);
    } catch (error) {
      kaelLogger.warn("discord.typing.failed", {
        channelId,
        sessionKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async sendChannelMessage(channelId: string, content: string, replyToId?: string): Promise<void> {
    await this.discordApi(`/channels/${channelId}/messages`, "POST", {
      content,
      ...(replyToId
        ? {
            message_reference: {
              message_id: replyToId,
              channel_id: channelId,
            },
            allowed_mentions: { replied_user: false },
          }
        : {}),
    });
  }

  private async discordApi<T = unknown>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetch(`https://discord.com/api/v10${path}`, {
          method,
          headers: {
            authorization: `Bot ${this.cfg.token}`,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const raw = await res.text();
        if (!res.ok) {
          const retryAfterHeader = res.headers.get("retry-after");
          const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
          const retryAfterMs =
            Number.isFinite(retryAfterSec) && retryAfterSec >= 0
              ? Math.ceil(retryAfterSec * 1000)
              : this.computeBackoffMs(attempt);
          const retryable = res.status === 429 || res.status >= 500;
          if (retryable && attempt < maxAttempts) {
            kaelLogger.warn("discord.api.retry", {
              path,
              method,
              status: res.status,
              attempt,
              retryAfterMs,
            });
            await this.sleep(retryAfterMs);
            continue;
          }
          throw new Error(`Discord API ${method} ${path} failed (${res.status}): ${raw.slice(0, 300)}`);
        }
        if (!raw.trim()) {
          return {} as T;
        }
        return JSON.parse(raw) as T;
      } catch (error) {
        const isNetworkError =
          error instanceof TypeError ||
          (error instanceof Error &&
            /(fetch failed|network|econn|socket|timeout|timed out|reset|disconnect)/i.test(error.message));
        if (!isNetworkError || attempt >= maxAttempts) {
          throw error;
        }
        const retryAfterMs = this.computeBackoffMs(attempt);
        kaelLogger.warn("discord.api.retry", {
          path,
          method,
          status: "network_error",
          attempt,
          retryAfterMs,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.sleep(retryAfterMs);
      }
    }
    throw new Error(`Discord API ${method} ${path} failed after retries`);
  }

  private computeBackoffMs(attempt: number): number {
    const base = 400;
    const exp = Math.min(5000, base * 2 ** Math.max(0, attempt - 1));
    const jitter = Math.floor(Math.random() * 200);
    return exp + jitter;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async extractInboundAttachments(
    msg: DiscordMessage,
    sessionKey: string,
  ): Promise<EngineInboundAttachment[]> {
    const input = Array.isArray(msg.attachments) ? msg.attachments : [];
    if (input.length === 0) {
      return [];
    }
    const out: EngineInboundAttachment[] = [];
    for (const attachment of input.slice(0, DISCORD_MEDIA_MAX_ATTACHMENTS)) {
      const mime = attachment.content_type?.trim().toLowerCase() || "";
      const url = attachment.url?.trim();
      if (!url) {
        continue;
      }
      const kind: EngineInboundAttachment["kind"] | null = mime.startsWith("image/")
        ? "image"
        : mime.startsWith("audio/")
          ? "audio"
          : null;
      if (!kind) {
        continue;
      }
      const declaredSize = typeof attachment.size === "number" ? attachment.size : null;
      if (declaredSize != null && declaredSize > DISCORD_MEDIA_MAX_BYTES) {
        kaelLogger.warn("discord.attachment.skipped", {
          reason: "too_large_declared",
          sessionKey,
          messageId: msg.id,
          fileName: attachment.filename ?? null,
          size: declaredSize,
        });
        continue;
      }
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        let response: Response;
        try {
          response = await fetch(url, { signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok) {
          throw new Error(`http ${response.status}`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length <= 0 || bytes.length > DISCORD_MEDIA_MAX_BYTES) {
          kaelLogger.warn("discord.attachment.skipped", {
            reason: "too_large_downloaded",
            sessionKey,
            messageId: msg.id,
            fileName: attachment.filename ?? null,
            size: bytes.length,
          });
          continue;
        }
        out.push({
          kind,
          dataBase64: bytes.toString("base64"),
          mimeType: mime || undefined,
          fileName: attachment.filename?.trim() || undefined,
        });
      } catch (error) {
        kaelLogger.warn("discord.attachment.download_failed", {
          sessionKey,
          messageId: msg.id,
          fileName: attachment.filename ?? null,
          url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return out;
  }
}
