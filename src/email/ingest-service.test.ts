import { describe, expect, it, vi } from "vitest";
import { EmailIngestService } from "./ingest-service.js";
import type { EmailProvider, EmailSender, InboundEmailMessage } from "./types.js";

describe("EmailIngestService", () => {
  it("processa mensagens do provider e encaminha para o chat", async () => {
    const poll = vi.fn<() => Promise<InboundEmailMessage[]>>(async () => [
      {
        id: "m-1",
        from: "Alice <alice@example.com>",
        fromEmail: "alice@example.com",
        subject: "Teste Kael",
        date: "Tue, 03 Mar 2026 10:00:00 +0000",
        body: "Ola Kael",
      },
    ]);
    const provider: EmailProvider = {
      init: async () => undefined,
      poll,
    };
    const handleMessage = vi.fn(async () => ({
      user: {} as never,
      assistant: {} as never,
      reply: "ok",
    }));
    const chat = {
      handleMessage,
    } as never;

    const service = new EmailIngestService(provider, chat);
    const result = await service.pollNow();

    expect(result.processed).toBe(1);
    expect(handleMessage).toHaveBeenCalledTimes(1);
    expect(handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "email:gmail:alice@example.com",
        requestId: "email:m-1",
      }),
    );
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("envia auto-reply quando sender estiver configurado", async () => {
    const provider: EmailProvider = {
      init: async () => undefined,
      poll: async () => [
        {
          id: "m-2",
          from: "Bob <bob@example.com>",
          fromEmail: "bob@example.com",
          subject: "Pergunta",
          body: "Oi",
        },
      ],
    };
    const sender: EmailSender = {
      sendReply: vi.fn(async () => undefined),
    };
    const chat = {
      handleMessage: vi.fn(async () => ({
        user: {} as never,
        assistant: {} as never,
        reply: "Resposta Kael",
      })),
    } as never;

    const service = new EmailIngestService(provider, chat, sender);
    await service.pollNow();

    expect(sender.sendReply).toHaveBeenCalledTimes(1);
    expect(sender.sendReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyText: "Resposta Kael",
      }),
    );
  });
});
