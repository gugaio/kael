import type { EngineInboundAttachment } from "../agents/types.js";
import { kaelLogger } from "../infra/logger.js";

export type MediaPreprocessInput = {
  sessionKey: string;
  message: string;
  attachments?: EngineInboundAttachment[];
  source?: "api" | "discord" | "email" | "unknown";
  requestId?: string;
};

export type MediaPreprocessOutput = {
  message: string;
  applied: boolean;
  details: Array<{
    kind: "image" | "audio";
    index: number;
    success: boolean;
    reason?: string;
  }>;
};

export type MediaRuntimeTelemetry = {
  processedRequests: number;
  appliedRequests: number;
  imageDescribed: number;
  audioTranscribed: number;
  failures: number;
  processedAttachments: number;
  skippedTooLarge: number;
  skippedBySourceLimit: number;
  skippedByTotalBytesBudget: number;
  skippedByProcessingBudget: number;
};

export interface MediaUnderstandingService {
  preprocess(input: MediaPreprocessInput): Promise<MediaPreprocessOutput>;
  getRuntimeTelemetrySnapshot(): MediaRuntimeTelemetry;
}

export type OpenAiMediaServiceConfig = {
  enabled: boolean;
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  maxAttachmentBytes: number;
  maxAttachmentsPerMessage: number;
  maxTotalBytesPerMessage: number;
  maxProcessingMsPerMessage: number;
  maxAttachmentsBySource: {
    api: number;
    discord: number;
    email: number;
    unknown: number;
  };
  imageModel: string;
  imagePrompt: string;
  audioModel: string;
};

function estimateBase64DecodedBytes(dataBase64: string): number {
  const normalized = dataBase64.trim();
  if (!normalized) return 0;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function toDataUrl(attachment: EngineInboundAttachment): string {
  const mimeType = attachment.mimeType?.trim() || "application/octet-stream";
  return `data:${mimeType};base64,${attachment.dataBase64}`;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function sanitizeAttachmentReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim().slice(0, 200);
}

function appendMediaSections(message: string, sections: string[]): string {
  const trimmed = message.trim();
  const block = ["[media_context]", ...sections].join("\n\n");
  if (!trimmed) {
    return block;
  }
  return `${trimmed}\n\n${block}`;
}

export class NoopMediaUnderstandingService implements MediaUnderstandingService {
  getRuntimeTelemetrySnapshot(): MediaRuntimeTelemetry {
    return {
      processedRequests: 0,
      appliedRequests: 0,
      imageDescribed: 0,
      audioTranscribed: 0,
      failures: 0,
      processedAttachments: 0,
      skippedTooLarge: 0,
      skippedBySourceLimit: 0,
      skippedByTotalBytesBudget: 0,
      skippedByProcessingBudget: 0,
    };
  }

  async preprocess(input: MediaPreprocessInput): Promise<MediaPreprocessOutput> {
    return {
      message: input.message,
      applied: false,
      details: [],
    };
  }
}

export class OpenAiMediaUnderstandingService implements MediaUnderstandingService {
  private readonly telemetry: MediaRuntimeTelemetry = {
    processedRequests: 0,
    appliedRequests: 0,
    imageDescribed: 0,
    audioTranscribed: 0,
    failures: 0,
    processedAttachments: 0,
    skippedTooLarge: 0,
    skippedBySourceLimit: 0,
    skippedByTotalBytesBudget: 0,
    skippedByProcessingBudget: 0,
  };

  constructor(private readonly cfg: OpenAiMediaServiceConfig) {}

  getRuntimeTelemetrySnapshot(): MediaRuntimeTelemetry {
    return { ...this.telemetry };
  }

  async preprocess(input: MediaPreprocessInput): Promise<MediaPreprocessOutput> {
    this.telemetry.processedRequests += 1;
    if (!this.cfg.enabled || !this.cfg.apiKey) {
      return { message: input.message, applied: false, details: [] };
    }
    const source = input.source ?? "unknown";
    const sourceLimit = this.cfg.maxAttachmentsBySource[source] ?? this.cfg.maxAttachmentsBySource.unknown;
    const hardLimit = Math.max(0, Math.min(this.cfg.maxAttachmentsPerMessage, sourceLimit));
    const allAttachments = input.attachments ?? [];
    const attachments = allAttachments.slice(0, hardLimit);
    if (allAttachments.length > attachments.length) {
      this.telemetry.skippedBySourceLimit += allAttachments.length - attachments.length;
    }
    if (attachments.length === 0) {
      return { message: input.message, applied: false, details: [] };
    }

    const details: MediaPreprocessOutput["details"] = [];
    const sections: string[] = [];

    const startedAt = Date.now();
    let accumulatedBytes = 0;
    for (let idx = 0; idx < attachments.length; idx += 1) {
      const attachment = attachments[idx];
      const attachmentIndex = idx + 1;
      if (Date.now() - startedAt > this.cfg.maxProcessingMsPerMessage) {
        details.push({
          kind: attachment.kind,
          index: attachmentIndex,
          success: false,
          reason: "deadline de processamento multimodal atingido",
        });
        this.telemetry.skippedByProcessingBudget += 1;
        continue;
      }
      const decodedBytes = estimateBase64DecodedBytes(attachment.dataBase64);
      if (decodedBytes <= 0 || decodedBytes > this.cfg.maxAttachmentBytes) {
        const reason = `tamanho fora do limite (${decodedBytes} bytes)`;
        details.push({ kind: attachment.kind, index: attachmentIndex, success: false, reason });
        this.telemetry.failures += 1;
        this.telemetry.skippedTooLarge += 1;
        continue;
      }
      if (accumulatedBytes + decodedBytes > this.cfg.maxTotalBytesPerMessage) {
        details.push({
          kind: attachment.kind,
          index: attachmentIndex,
          success: false,
          reason: "orcamento total de bytes multimodais excedido",
        });
        this.telemetry.skippedByTotalBytesBudget += 1;
        continue;
      }
      try {
        if (attachment.kind === "image") {
          const description = await this.describeImage(input.message, attachment);
          sections.push(`[Image ${attachmentIndex} Description]\n${description}`);
          details.push({ kind: "image", index: attachmentIndex, success: true });
          this.telemetry.imageDescribed += 1;
          this.telemetry.processedAttachments += 1;
          accumulatedBytes += decodedBytes;
          continue;
        }
        const transcript = await this.transcribeAudio(attachment);
        sections.push(`[Audio ${attachmentIndex} Transcript]\n${transcript}`);
        details.push({ kind: "audio", index: attachmentIndex, success: true });
        this.telemetry.audioTranscribed += 1;
        this.telemetry.processedAttachments += 1;
        accumulatedBytes += decodedBytes;
      } catch (error) {
        const reason = sanitizeAttachmentReason(error instanceof Error ? error.message : String(error));
        details.push({
          kind: attachment.kind,
          index: attachmentIndex,
          success: false,
          reason,
        });
        this.telemetry.failures += 1;
        kaelLogger.warn("media.preprocess.attachment_failed", {
          sessionKey: input.sessionKey,
          requestId: input.requestId ?? null,
          kind: attachment.kind,
          index: attachmentIndex,
          reason,
        });
      }
    }

    if (sections.length === 0) {
      return {
        message: input.message,
        applied: false,
        details,
      };
    }
    this.telemetry.appliedRequests += 1;
    return {
      message: appendMediaSections(input.message, sections),
      applied: true,
      details,
    };
  }

  private async describeImage(userMessage: string, attachment: EngineInboundAttachment): Promise<string> {
    const baseUrl = normalizeBaseUrl(this.cfg.baseUrl);
    const response = await this.fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.cfg.imageModel,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: this.cfg.imagePrompt,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userMessage?.trim()
                  ? `Pedido do usuario: ${userMessage}\nDescreva elementos relevantes para responder ao pedido.`
                  : "Descreva de forma objetiva os elementos relevantes da imagem.",
              },
              {
                type: "image_url",
                image_url: {
                  url: toDataUrl(attachment),
                },
              },
            ],
          },
        ],
      }),
    });
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("resposta de visao sem texto");
    }
    return text;
  }

  private async transcribeAudio(attachment: EngineInboundAttachment): Promise<string> {
    const baseUrl = normalizeBaseUrl(this.cfg.baseUrl);
    const bytes = Buffer.from(attachment.dataBase64, "base64");
    const mimeType = attachment.mimeType?.trim() || "application/octet-stream";
    const fileName = attachment.fileName?.trim() || "audio";
    const form = new FormData();
    form.append("model", this.cfg.audioModel);
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
    const response = await this.fetchWithTimeout(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: form,
    });
    const payload = (await response.json()) as { text?: string };
    const text = payload.text?.trim();
    if (!text) {
      throw new Error("resposta de transcricao sem texto");
    }
    return text;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`http ${response.status}: ${raw.slice(0, 180)}`);
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
