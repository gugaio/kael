import type { EngineOutputArtifact } from "../agents/types.js";
import type { ImageGeneratorService } from "./image-generator.js";
import { NoopImageGeneratorService } from "./image-generator.js";
import type { MediaArtifactsService, StoredMediaArtifact } from "./artifacts.js";

export type MediaGenerationRequest = {
  sessionKey: string;
  prompt: string;
  provider?: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
  durationSeconds?: number;
};

export type MediaGenerationResult = {
  artifact: EngineOutputArtifact;
  record: StoredMediaArtifact;
};

export interface MediaGenerationService {
  generateImage(params: MediaGenerationRequest): Promise<MediaGenerationResult>;
  generateVideo(params: MediaGenerationRequest): Promise<never>;
}

export class ProviderBackedMediaGenerationService implements MediaGenerationService {
  constructor(
    private readonly imageGenerator: ImageGeneratorService,
    private readonly artifacts: MediaArtifactsService,
    private readonly defaults: {
      imageProvider: string;
      videoProvider?: string;
    } = {
      imageProvider: "image_generator",
    },
  ) {}

  async generateImage(params: MediaGenerationRequest): Promise<MediaGenerationResult> {
    const artifact = await this.imageGenerator.generate({
      prompt: params.prompt,
      size: params.size,
    });
    const record = await this.artifacts.saveGeneratedArtifact({
      sessionKey: params.sessionKey,
      prompt: params.prompt,
      provider: params.provider?.trim() || this.defaults.imageProvider,
      artifact,
    });
    return { artifact, record };
  }

  async generateVideo(params: MediaGenerationRequest): Promise<never> {
    const provider = params.provider?.trim() || this.defaults.videoProvider || "unconfigured";
    throw new Error(`video generation not implemented for provider=${provider}`);
  }
}

export class NoopMediaGenerationService implements MediaGenerationService {
  constructor(private readonly imageGenerator: ImageGeneratorService = new NoopImageGeneratorService()) {}

  async generateImage(params: MediaGenerationRequest): Promise<MediaGenerationResult> {
    const artifact = await this.imageGenerator.generate({
      prompt: params.prompt,
      size: params.size,
    });
    return {
      artifact,
      record: {
        id: "noop",
        sessionKey: params.sessionKey,
        kind: artifact.kind,
        provider: "disabled",
        prompt: params.prompt,
        fileName: artifact.fileName,
        filePath: "",
        metadataPath: "",
        mimeType: artifact.mimeType,
        bytes: Buffer.from(artifact.dataBase64, "base64").byteLength,
        createdAt: new Date().toISOString(),
      },
    };
  }

  async generateVideo(): Promise<never> {
    throw new Error("video generation disabled");
  }
}
