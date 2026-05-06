import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { EngineOutputArtifact } from "../../agents/types.js";
import type { StoredArtifactRecord } from "./types.js";

export class VideoArtifactsService {
  constructor(private readonly rootDir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async saveGeneratedArtifact(params: {
    sessionKey: string;
    prompt: string;
    provider: string;
    artifact: EngineOutputArtifact;
  }): Promise<StoredArtifactRecord> {
    const id = randomUUID();
    const safeSessionKey = sanitizePathSegment(params.sessionKey);
    const dir = path.join(this.rootDir, safeSessionKey);
    await fs.mkdir(dir, { recursive: true });

    const extension = extensionFromMimeType(params.artifact.mimeType);
    const baseName = `${id}.${extension}`;
    const filePath = path.join(dir, baseName);
    const metadataPath = path.join(dir, `${id}.json`);
    const bytes = Buffer.from(params.artifact.dataBase64, "base64");
    await fs.writeFile(filePath, bytes);

    const record: StoredArtifactRecord = {
      id,
      sessionKey: params.sessionKey,
      kind: params.artifact.kind,
      provider: params.provider,
      prompt: params.prompt,
      fileName: params.artifact.fileName,
      filePath,
      metadataPath,
      mimeType: params.artifact.mimeType,
      bytes: bytes.byteLength,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(metadataPath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
    return record;
  }
}

function sanitizePathSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return normalized || "session";
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "video/mp4") {
    return "mp4";
  }
  return "bin";
}
