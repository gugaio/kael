import { afterEach, describe, expect, it, vi } from "vitest";
import { NoopMediaUnderstandingService, OpenAiMediaUnderstandingService } from "./service.js";

describe("NoopMediaUnderstandingService", () => {
  it("returns original message without applying media", async () => {
    const service = new NoopMediaUnderstandingService();
    const result = await service.preprocess({
      sessionKey: "s1",
      message: "oi",
      attachments: [
        {
          kind: "image",
          dataBase64: "aGVsbG8=",
          mimeType: "image/png",
        },
      ],
    });
    expect(result.applied).toBe(false);
    expect(result.message).toBe("oi");
    expect(result.details).toEqual([]);
  });
});

describe("OpenAiMediaUnderstandingService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("adds media context for image and audio attachments", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const rawUrl = String(url);
      if (rawUrl.endsWith("/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Foto de um time de futebol em campo." } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (rawUrl.endsWith("/audio/transcriptions")) {
        return new Response(JSON.stringify({ text: "Meu time e o Sport." }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const service = new OpenAiMediaUnderstandingService({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: 5000,
      maxAttachmentBytes: 1_000_000,
      maxTotalBytesPerMessage: 2_000_000,
      maxProcessingMsPerMessage: 10_000,
      maxAttachmentsPerMessage: 3,
      maxAttachmentsBySource: {
        api: 3,
        discord: 2,
        email: 1,
        unknown: 2,
      },
      imageModel: "gpt-4o-mini",
      imagePrompt: "Descreva a imagem.",
      audioModel: "gpt-4o-mini-transcribe",
    });

    const result = await service.preprocess({
      sessionKey: "s1",
      message: "qual e meu time?",
      attachments: [
        {
          kind: "image",
          dataBase64: "aGVsbG8=",
          mimeType: "image/png",
          fileName: "foto.png",
        },
        {
          kind: "audio",
          dataBase64: "aGVsbG8=",
          mimeType: "audio/ogg",
          fileName: "voice.ogg",
        },
      ],
      source: "api",
    });

    expect(result.applied).toBe(true);
    expect(result.message).toContain("[media_context]");
    expect(result.message).toContain("[Image 1 Description]");
    expect(result.message).toContain("[Audio 2 Transcript]");
    expect(result.details.every((item) => item.success)).toBe(true);

    const snapshot = service.getRuntimeTelemetrySnapshot();
    expect(snapshot.processedRequests).toBe(1);
    expect(snapshot.appliedRequests).toBe(1);
    expect(snapshot.imageDescribed).toBe(1);
    expect(snapshot.audioTranscribed).toBe(1);
    expect(snapshot.failures).toBe(0);
    expect(snapshot.processedAttachments).toBe(2);
  });

  it("applies source attachment limit and records skipped telemetry", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const rawUrl = String(url);
      if (rawUrl.endsWith("/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Imagem valida." } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const service = new OpenAiMediaUnderstandingService({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: 5000,
      maxAttachmentBytes: 1_000_000,
      maxTotalBytesPerMessage: 2_000_000,
      maxProcessingMsPerMessage: 10_000,
      maxAttachmentsPerMessage: 4,
      maxAttachmentsBySource: {
        api: 3,
        discord: 1,
        email: 1,
        unknown: 1,
      },
      imageModel: "gpt-4o-mini",
      imagePrompt: "Descreva a imagem.",
      audioModel: "gpt-4o-mini-transcribe",
    });

    const result = await service.preprocess({
      sessionKey: "s1",
      message: "descreve",
      source: "discord",
      attachments: [
        { kind: "image", dataBase64: "aGVsbG8=", mimeType: "image/png" },
        { kind: "image", dataBase64: "aGVsbG8=", mimeType: "image/png" },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.details.length).toBe(1);
    const snapshot = service.getRuntimeTelemetrySnapshot();
    expect(snapshot.skippedBySourceLimit).toBe(1);
    expect(snapshot.processedAttachments).toBe(1);
  });
});
