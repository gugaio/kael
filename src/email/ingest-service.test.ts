import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EmailIngestService } from "./ingest-service.js";
import { FileEmailIngestDedupeStore } from "./ingest-dedupe-store.js";
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
    const handleMessage = vi.fn(async (_input: unknown) => ({
      user: {} as never,
      assistant: {} as never,
      reply: "ok",
    }));
    const chat = {
      handleMessage,
    } as never;

    const service = new EmailIngestService(provider, chat);
    const result = await service.pollNow();
    const telemetry = service.getRuntimeTelemetrySnapshot();

    expect(result.processed).toBe(1);
    expect(telemetry.polls).toBe(1);
    expect(telemetry.messagesSeen).toBe(1);
    expect(telemetry.processed).toBe(1);
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

  it("sanitiza blocos base64 de email antes de enviar ao chat", async () => {
    const provider: EmailProvider = {
      init: async () => undefined,
      poll: async () => [
        {
          id: "m-3",
          from: "Carol <carol@example.com>",
          fromEmail: "carol@example.com",
          subject: "Foto",
          body: [
            "Content-Type: image/jpeg; name=\"surf.jpg\"",
            "Content-Transfer-Encoding: base64",
            "",
            "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
            "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
            "--boundary123",
          ].join("\n"),
        },
      ],
    };
    const handleMessage = vi.fn(async () => ({
      user: {} as never,
      assistant: {} as never,
      reply: "ok",
    }));
    const chat = { handleMessage } as never;
    const service = new EmailIngestService(provider, chat);

    await service.pollNow();

    const payload = (handleMessage as unknown as { mock: { calls: Array<Array<unknown>> } }).mock.calls[0]?.[0] as
      | { message: string }
      | undefined;
    expect(payload?.message).toContain("[[base64_omitted_lines:");
    expect(payload?.message).not.toContain("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=");
  });

  it("nao processa mensagem duplicada em polls consecutivos", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "kael-email-dedupe-"));
    try {
      const message: InboundEmailMessage = {
        id: "dup-1",
        from: "Alice <alice@example.com>",
        fromEmail: "alice@example.com",
        subject: "Teste",
        body: "Ola",
      };
      const provider: EmailProvider = {
        init: async () => undefined,
        poll: async () => [message],
      };
      const handleMessage = vi.fn(async () => ({
        user: {} as never,
        assistant: {} as never,
        reply: "ok",
      }));
      const service = new EmailIngestService(
        provider,
        { handleMessage } as never,
        undefined,
        new FileEmailIngestDedupeStore({ rootDir }),
      );
      await service.init();

      const first = await service.pollNow();
      const second = await service.pollNow();
      const telemetry = service.getRuntimeTelemetrySnapshot();

      expect(first.processed).toBe(1);
      expect(second.processed).toBe(0);
      expect(second).toMatchObject({ skippedDuplicates: 1 });
      expect(telemetry.duplicateSkipped).toBe(1);
      expect(handleMessage).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("evita processamento duplicado entre duas instancias concorrentes", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "kael-email-dedupe-"));
    try {
      const message: InboundEmailMessage = {
        id: "dup-race-1",
        from: "Bob <bob@example.com>",
        fromEmail: "bob@example.com",
        subject: "Teste concorrencia",
        body: "Ola",
      };
      const providerA: EmailProvider = {
        init: async () => undefined,
        poll: async () => [message],
      };
      const providerB: EmailProvider = {
        init: async () => undefined,
        poll: async () => [message],
      };
      const handleMessage = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          user: {} as never,
          assistant: {} as never,
          reply: "ok",
        };
      });
      const dedupeA = new FileEmailIngestDedupeStore({ rootDir });
      const dedupeB = new FileEmailIngestDedupeStore({ rootDir });
      const serviceA = new EmailIngestService(providerA, { handleMessage } as never, undefined, dedupeA);
      const serviceB = new EmailIngestService(providerB, { handleMessage } as never, undefined, dedupeB);
      await Promise.all([serviceA.init(), serviceB.init()]);

      const [resultA, resultB] = await Promise.all([serviceA.pollNow(), serviceB.pollNow()]);

      expect(resultA.processed + resultB.processed).toBe(1);
      expect(handleMessage).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
