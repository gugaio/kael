import { loadConfig, type KaelConfig } from "./config.js";
import { JobManager } from "./jobs/manager.js";
import { JobStore } from "./jobs/store.js";
import { SessionStore } from "./session/store.js";
import { LocalProcessRunner } from "./tools/system/process-runner.js";
import { TranscodeService } from "./tools/video/transcode-service.js";
import { SimpleCommandEngine } from "./engine/simple-engine.js";
import { ChatService } from "./services/chat-service.js";

export type KaelApp = {
  config: KaelConfig;
  sessions: SessionStore;
  jobs: JobManager;
  chat: ChatService;
};

export async function createKaelApp(): Promise<KaelApp> {
  const config = loadConfig();
  const sessions = new SessionStore(config.dataDir);
  const jobStore = new JobStore(config.dataDir);

  await sessions.init();
  await jobStore.init();

  const runner = new LocalProcessRunner();
  const transcode = new TranscodeService(jobStore, runner);
  const jobs = new JobManager(jobStore, transcode);
  const engine = new SimpleCommandEngine();
  const chat = new ChatService(sessions, jobs, engine);

  return {
    config,
    sessions,
    jobs,
    chat,
  };
}
