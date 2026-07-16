import { createEngine } from "../../agents/factory.js";
import type { AgentContext } from "../../agents/context.js";
import { ChatService } from "../../chat/service.js";
import { TurnOrchestrator } from "../../chat/turn-orchestrator.js";
import type { KaelConfig } from "../../config.js";
import type { CoreModule } from "./core.js";
import type { AgentCoreModule } from "./agent-core.js";
import type { MediaModule } from "./media.js";
import type { ServicesModule } from "./services.js";
import type { VideoModule } from "./video.js";

export type ChatModule = {
  agentContext: AgentContext;
  chat: ChatService;
};

export function bootstrapChatModule(
  config: KaelConfig,
  deps: {
    core: CoreModule;
    video: VideoModule;
    agentCore: AgentCoreModule;
    services: ServicesModule;
    media: MediaModule;
  },
): ChatModule {
  const engine = createEngine(config);
  const orchestrator = new TurnOrchestrator(deps.core.sessions, engine, {
    maxContextMessages: config.context.maxMessages,
    maxContextChars: config.context.maxChars,
  });
  const agentContext: AgentContext = {
    core: {
      sessions: deps.core.sessions,
      orchestrator,
    },
    runtimes: {
      shell: deps.agentCore.shell,
      mcp: deps.agentCore.mcp,
      edge: deps.agentCore.edge,
      browser: deps.agentCore.browser,
    },
    services: {
      memory: deps.services.memory,
      workspace: deps.services.workspace,
      research: deps.services.research,
      planner: deps.services.planner,
      skills: deps.services.skills,
      media: deps.media.mediaUnderstanding,
    },
    video: {
      jobs: deps.core.jobs,
      ffmpeg: deps.video.ffmpeg,
      inspect: deps.video.videoInspect,
      playbackTriage: deps.video.playback,
      streamMonitor: deps.video.streamMonitor,
      streamer: deps.video.streamer,
      serveManager: deps.video.serveManager,
    },
    generation: {
      image: deps.media.imageGenerator,
      video: deps.media.videoGeneration,
    },
  };

  return {
    agentContext,
    chat: new ChatService(agentContext),
  };
}
