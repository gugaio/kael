import type { KaelConfig } from "../../config.js";
import type { MediaArtifactsService } from "../../media/artifacts.js";
import { ProviderBackedMediaGenerationService } from "../../media/generation.js";
import {
  NoopImageGeneratorService,
  OpenAiImageGeneratorService,
  type ImageGeneratorService,
} from "../../media/image-generator.js";
import {
  NoopMediaUnderstandingService,
  OpenAiMediaUnderstandingService,
  type MediaUnderstandingService,
} from "../../media/service.js";

export type MediaModule = {
  mediaUnderstanding: MediaUnderstandingService;
  imageGenerator: ImageGeneratorService;
  videoGeneration: ProviderBackedMediaGenerationService;
};

function createImageGenerator(config: KaelConfig): ImageGeneratorService {
  if (!config.media.enabled || !config.media.apiKey) {
    return new NoopImageGeneratorService();
  }
  return new OpenAiImageGeneratorService({
    apiKey: config.media.apiKey,
    baseUrl: config.media.baseUrl,
    timeoutMs: config.media.imageGenerationTimeoutMs,
    model: process.env.KAEL_IMAGE_GENERATION_MODEL?.trim() || "gpt-image-1",
  });
}

export function bootstrapMediaModule(
  config: KaelConfig,
  deps: { mediaArtifacts: MediaArtifactsService },
): MediaModule {
  const imageGenerator = createImageGenerator(config);
  const mediaUnderstanding = config.media.enabled
    ? new OpenAiMediaUnderstandingService({
        enabled: config.media.enabled,
        apiKey: config.media.apiKey,
        baseUrl: config.media.baseUrl,
        timeoutMs: config.media.timeoutMs,
        maxAttachmentBytes: config.media.maxAttachmentBytes,
        maxTotalBytesPerMessage: config.media.maxTotalBytesPerMessage,
        maxProcessingMsPerMessage: config.media.maxProcessingMsPerMessage,
        maxAttachmentsPerMessage: config.media.maxAttachmentsPerMessage,
        maxAttachmentsBySource: config.media.maxAttachmentsBySource,
        imageModel: config.media.imageModel,
        imagePrompt: config.media.imagePrompt,
        audioModel: config.media.audioModel,
      })
    : new NoopMediaUnderstandingService();

  const videoGeneration = new ProviderBackedMediaGenerationService(
    imageGenerator,
    deps.mediaArtifacts,
    {
      imageProvider: process.env.KAEL_IMAGE_GENERATION_MODEL?.trim() || "gpt-image-1",
      videoProvider: process.env.KAEL_VIDEO_GENERATION_PROVIDER?.trim() || undefined,
    },
  );

  return {
    mediaUnderstanding,
    imageGenerator,
    videoGeneration,
  };
}
