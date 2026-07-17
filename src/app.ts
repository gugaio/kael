import "dotenv/config";
import {
  bootstrapAgentCoreModule,
} from "./bootstrap/modules/agent-core.js";
import {
  bootstrapAutomationModule,
  type AutomationModule,
} from "./bootstrap/modules/automation.js";
import { bootstrapChatModule } from "./bootstrap/modules/chat.js";
import { bootstrapCoreModule, type CoreModule } from "./bootstrap/modules/core.js";
import { bootstrapMediaModule } from "./bootstrap/modules/media.js";
import { bootstrapMediaInvestigationModule } from "./bootstrap/modules/media-investigation.js";
import { bootstrapServicesModule } from "./bootstrap/modules/services.js";
import { bootstrapVideoModule } from "./bootstrap/modules/video.js";

export type KaelApp = {
  config: CoreModule["config"];
  agent: ReturnType<typeof bootstrapChatModule>["agentContext"];
  chat: ReturnType<typeof bootstrapChatModule>["chat"];
  automation: AutomationModule["automation"];
  emailIngest?: AutomationModule["emailIngest"];
};

export type CreateKaelAppOptions = {
  startAutomation?: boolean;
  enableEmailPolling?: boolean;
};

export async function createKaelApp(options: CreateKaelAppOptions = {}): Promise<KaelApp> {
  const startAutomation = options.startAutomation ?? true;
  const enableEmailPolling = options.enableEmailPolling ?? startAutomation;

  const core = await bootstrapCoreModule();
  const video = await bootstrapVideoModule(core.config, { jobs: core.jobs });
  const agentCore = await bootstrapAgentCoreModule(core.config);
  const services = await bootstrapServicesModule(core.config, { ffmpeg: video.ffmpeg });
  const media = bootstrapMediaModule(core.config, { mediaArtifacts: video.mediaArtifacts });
  const mediaInvestigation = await bootstrapMediaInvestigationModule(core.config, {
    streamer: video.streamer,
    pi: agentCore.pi,
  });
  const chat = bootstrapChatModule(core.config, {
    core,
    video,
    agentCore,
    services,
    media,
    mediaInvestigation,
  });
  const automation = await bootstrapAutomationModule(core.config, {
    startAutomation,
    enableEmailPolling,
    jobs: core.jobs,
    sessions: core.sessions,
    planner: services.planner,
    shell: agentCore.shell,
    chat: chat.chat,
  });

  return {
    config: core.config,
    agent: chat.agentContext,
    chat: chat.chat,
    automation: automation.automation,
    ...(automation.emailIngest ? { emailIngest: automation.emailIngest } : {}),
  };
}
