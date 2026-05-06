import type { EngineOutputArtifact } from "../../agents/types.js";
import type { ImageGeneratorService } from "../../media/image-generator.js";
import { NoopImageGeneratorService } from "../../media/image-generator.js";
import type { StoredArtifactRecord, VideoGenerationRequest } from "./types.js";
import type { VideoArtifactsService } from "./artifacts-service.js";

export type VideoGenerationResult = {
  artifact: EngineOutputArtifact;
  record: StoredArtifactRecord;
};

export interface VideoGenerationService {
  generateImage(params: VideoGenerationRequest): Promise<VideoGenerationResult>;
  generateVideo(params: VideoGenerationRequest): Promise<never>;
}

export class ProviderBackedVideoGenerationService implements VideoGenerationService {
  constructor(
    private readonly imageGenerator: ImageGeneratorService,
    private readonly artifacts: VideoArtifactsService,
    private readonly defaults: {
      imageProvider: string;
      videoProvider?: string;
    } = {
      imageProvider: "image_generator",
    },
  ) {}

  async generateImage(params: VideoGenerationRequest): Promise<VideoGenerationResult> {
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

  async generateVideo(params: VideoGenerationRequest): Promise<never> {
    const provider = params.provider?.trim() || this.defaults.videoProvider || "unconfigured";
    throw new Error(`video generation not implemented for provider=${provider}`);
  }
}

export class NoopVideoGenerationService implements VideoGenerationService {
  constructor(private readonly imageGenerator: ImageGeneratorService = new NoopImageGeneratorService()) {}

  async generateImage(params: VideoGenerationRequest): Promise<VideoGenerationResult> {
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
