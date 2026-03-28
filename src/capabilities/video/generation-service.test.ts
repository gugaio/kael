import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ImageGeneratorService } from "../../media/image-generator.js";
import { VideoArtifactsService } from "./artifacts-service.js";
import { ProviderBackedVideoGenerationService } from "./generation-service.js";

describe("ProviderBackedVideoGenerationService", () => {
  it("gera imagem via provider e persiste artifact", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-video-generation-"));
    const artifacts = new VideoArtifactsService(root);
    await artifacts.init();

    const imageGenerator: ImageGeneratorService = {
      generate: async () => ({
        kind: "image",
        dataBase64: Buffer.from("fake-image").toString("base64"),
        mimeType: "image/png",
        fileName: "frame.png",
      }),
    };

    const service = new ProviderBackedVideoGenerationService(imageGenerator, artifacts, {
      imageProvider: "gpt-image-1",
    });
    const result = await service.generateImage({
      sessionKey: "video-session",
      prompt: "gera um frame de teaser esportivo",
      size: "1536x1024",
    });

    expect(result.record.provider).toBe("gpt-image-1");
    expect(result.record.prompt).toContain("teaser esportivo");
    expect(result.artifact.mimeType).toBe("image/png");
    const fileStat = await fs.stat(result.record.filePath);
    expect(fileStat.isFile()).toBe(true);
  });
});
