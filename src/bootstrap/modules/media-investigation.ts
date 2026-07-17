import path from "node:path";
import type { KaelConfig } from "../../config.js";
import { MediaInvestigationService } from "../../media-investigation/service.js";
import { MediaInvestigationProfileRunner } from "../../media-investigation/profile-runner.js";
import type { StreamerRuntime } from "../../agents/context.js";
import type { PiAgentRuntime } from "../../agents/pi-runtime.js";

export type MediaInvestigationModule = {
  investigations: MediaInvestigationService;
};

export async function bootstrapMediaInvestigationModule(
  config: KaelConfig,
  deps: { streamer: StreamerRuntime; pi: PiAgentRuntime },
): Promise<MediaInvestigationModule> {
  const promptsDir = process.env.KAEL_MEDIA_INVESTIGATION_PROMPTS_DIR?.trim()
    ? path.resolve(process.env.KAEL_MEDIA_INVESTIGATION_PROMPTS_DIR.trim())
    : path.join(process.cwd(), ".kael", "agents", "media-investigation");
  const investigations = new MediaInvestigationService(
    deps.streamer,
    new MediaInvestigationProfileRunner(config.pi, deps.pi),
    path.join(config.dataDir, "media-investigations"),
    promptsDir,
  );
  await investigations.init();
  return { investigations };
}
