import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiImageGeneratorService } from "./image-generator.js";

describe("OpenAiImageGeneratorService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("retries without response_format when endpoint rejects the parameter", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if ("response_format" in body) {
        return new Response(
          JSON.stringify({
            error: { message: "Unknown parameter: 'response_format'" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          data: [{ b64_json: "aGVsbG8=" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const service = new OpenAiImageGeneratorService({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: 3000,
      model: "gpt-image-1",
    });

    const artifact = await service.generate({ prompt: "um surfista no mar" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    const secondPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    expect(firstPayload.response_format).toBe("b64_json");
    expect(secondPayload.response_format).toBeUndefined();
    expect(artifact.kind).toBe("image");
    expect(artifact.dataBase64).toBe("aGVsbG8=");
    expect(artifact.mimeType).toBe("image/png");
  });

  it("downloads image when API returns URL payload", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const rawUrl = String(url);
      if (rawUrl.endsWith("/images/generations")) {
        return new Response(
          JSON.stringify({
            data: [{ url: "https://files.example.com/generated.png" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (rawUrl === "https://files.example.com/generated.png") {
        return new Response(Uint8Array.from([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const service = new OpenAiImageGeneratorService({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: 3000,
      model: "gpt-image-1",
    });

    const artifact = await service.generate({ prompt: "um kael futurista" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(artifact.kind).toBe("image");
    expect(artifact.dataBase64).toBe(Buffer.from([1, 2, 3, 4]).toString("base64"));
    expect(artifact.mimeType).toBe("image/png");
  });
});
