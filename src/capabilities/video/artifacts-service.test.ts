import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VideoArtifactsService } from "./artifacts-service.js";

describe("VideoArtifactsService", () => {
  it("persiste artifact gerado com metadata ao lado do arquivo", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-video-artifacts-"));
    const service = new VideoArtifactsService(root);
    await service.init();

    const record = await service.saveGeneratedArtifact({
      sessionKey: "session/video:1",
      prompt: "gera thumbnail do stream",
      provider: "gpt-image-1",
      artifact: {
        kind: "image",
        dataBase64: Buffer.from("fake-image").toString("base64"),
        mimeType: "image/png",
        fileName: "thumb.png",
      },
    });

    const fileStat = await fs.stat(record.filePath);
    const metadata = JSON.parse(await fs.readFile(record.metadataPath, "utf-8")) as { provider: string; prompt: string };

    expect(fileStat.isFile()).toBe(true);
    expect(metadata.provider).toBe("gpt-image-1");
    expect(metadata.prompt).toBe("gera thumbnail do stream");
    expect(record.bytes).toBeGreaterThan(0);
  });
});
