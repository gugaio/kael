import "dotenv/config";
import { loadConfig, type KaelConfig } from "./config.js";
import { createEngine } from "./engine/factory.js";
import { JobManager } from "./jobs/manager.js";
import { JobStore } from "./jobs/store.js";
import { SessionStore } from "./session/store.js";
import { ChatService } from "./services/chat-service.js";
import { TurnOrchestrator } from "./services/turn-orchestrator.js";
import { LocalProcessRunner } from "./tools/system/process-runner.js";
import { VideoJobService } from "./tools/video/video-job-service.js";

export type KaelApp = {
  config: KaelConfig;
  sessions: SessionStore;
  jobs: JobManager;
  chat: ChatService;
};

export async function createKaelApp(): Promise<KaelApp> {
  const config = await loadConfig();
  const sessions = new SessionStore(config.dataDir);
  const jobStore = new JobStore(config.dataDir);

  await sessions.init();
  await jobStore.init();

  const runner = new LocalProcessRunner();
  const video = new VideoJobService(jobStore, runner);
  const jobs = new JobManager(jobStore, video);
  const engine = createEngine(config);
  const orchestrator = new TurnOrchestrator(sessions, engine, {
    maxContextMessages: config.context.maxMessages,
    maxContextChars: config.context.maxChars,
  });
  const chat = new ChatService(sessions, jobs, orchestrator);

  return {
    config,
    sessions,
    jobs,
    chat,
  };
}
