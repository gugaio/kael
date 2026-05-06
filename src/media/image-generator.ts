import { randomUUID } from "node:crypto";
import type { EngineOutputArtifact } from "../agents/types.js";
import { kaelLogger } from "../infra/logger.js";

export interface ImageGeneratorService {
  generate(params: {
    prompt: string;
    size?: "1024x1024" | "1536x1024" | "1024x1536";
  }): Promise<EngineOutputArtifact>;
}

export class NoopImageGeneratorService implements ImageGeneratorService {
  async generate(): Promise<EngineOutputArtifact> {
    throw new Error("image generation disabled");
  }
}

type OpenAiImageGeneratorConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  model: string;
};

export class OpenAiImageGeneratorService implements ImageGeneratorService {
  constructor(private readonly cfg: OpenAiImageGeneratorConfig) {}

  async generate(params: {
    prompt: string;
    size?: "1024x1024" | "1536x1024" | "1024x1536";
  }): Promise<EngineOutputArtifact> {
    const baseUrl = this.cfg.baseUrl.replace(/\/+$/, "");
    const basePayload: Record<string, unknown> = {
      model: this.cfg.model,
      prompt: params.prompt,
      size: params.size ?? "1024x1024",
    };

    let attempt = await this.callImagesGeneration(baseUrl, {
      ...basePayload,
      response_format: "b64_json",
    });

    if (!attempt.ok && attempt.status === 400 && isUnknownResponseFormatError(attempt.raw)) {
      kaelLogger.warn("media.image_generate.retry_without_response_format", {
        model: this.cfg.model,
        reason: "endpoint_unknown_parameter_response_format",
      });
      attempt = await this.callImagesGeneration(baseUrl, basePayload);
    }

    if (!attempt.ok) {
      throw new Error(`image generation failed (${attempt.status}): ${attempt.raw.slice(0, 220)}`);
    }

    const payload = JSON.parse(attempt.raw) as {
      data?: Array<{ b64_json?: string; base64?: string; url?: string }>;
    };
    const first = payload.data?.[0];
    const inlineBase64 = first?.b64_json?.trim() || first?.base64?.trim();
    const dataBase64 = inlineBase64 || (first?.url ? await this.fetchImageAsBase64(first.url) : "");
    if (!dataBase64) {
      throw new Error("image generation response missing image payload");
    }
    return {
      kind: "image",
      dataBase64,
      mimeType: "image/png",
      fileName: `kael-image-${randomUUID().slice(0, 8)}.png`,
    };
  }

  private async callImagesGeneration(
    baseUrl: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; raw: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const raw = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        raw,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchImageAsBase64(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`image download failed (${response.status}): ${raw.slice(0, 200)}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.toString("base64");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isUnknownResponseFormatError(raw: string): boolean {
  const text = raw.toLowerCase();
  return text.includes("unknown parameter") && text.includes("response_format");
}
