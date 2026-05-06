import type { EngineInboundAttachment } from "../agents/types.js";
import type { IdempotencyStore } from "../infra/idempotency-store.js";
import { ApiError } from "./errors.js";

export function readIdempotencyKey(headerValue: string | string[] | undefined): string | null {
  if (Array.isArray(headerValue)) {
    return readIdempotencyKey(headerValue[0]);
  }
  const value = headerValue?.trim();
  return value ? value : null;
}

export function bodySessionKey(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const value = (body as { sessionKey?: unknown }).sessionKey;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeInboundAttachments(raw: unknown): EngineInboundAttachment[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: EngineInboundAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new ApiError(400, "BAD_REQUEST", "attachments invalidos");
    }
    const kindRaw = (item as { kind?: unknown }).kind;
    const kind = kindRaw === "image" || kindRaw === "audio" ? kindRaw : null;
    const dataBase64 = (item as { dataBase64?: unknown }).dataBase64;
    if (!kind || typeof dataBase64 !== "string" || !dataBase64.trim()) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "attachment invalido: use {kind: image|audio, dataBase64: string}",
      );
    }
    const mimeTypeRaw = (item as { mimeType?: unknown }).mimeType;
    const fileNameRaw = (item as { fileName?: unknown }).fileName;
    out.push({
      kind,
      dataBase64: dataBase64.trim(),
      mimeType: typeof mimeTypeRaw === "string" ? mimeTypeRaw.trim() || undefined : undefined,
      fileName: typeof fileNameRaw === "string" ? fileNameRaw.trim() || undefined : undefined,
    });
  }
  return out;
}

export async function withIdempotency<T>(params: {
  store: IdempotencyStore;
  enabled: boolean;
  scope: string;
  idempotencyKey: string | null;
  signature: string;
  execute: () => Promise<T>;
}): Promise<{ replayed: boolean; value: T }> {
  if (!params.enabled || !params.idempotencyKey) {
    return { replayed: false, value: await params.execute() };
  }

  return params.store.execute({
    key: `${params.scope}:${params.idempotencyKey}`,
    signature: params.signature,
    handler: params.execute,
  });
}
