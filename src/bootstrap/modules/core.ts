import { loadConfig, type KaelConfig } from "../../config.js";
import { JobService } from "../../jobs/service.js";
import { JobStore } from "../../jobs/store.js";
import { LocalProcessSupervisor } from "../../process/supervisor.js";
import { SessionStore } from "../../session/store.js";
import { LocalProcessRunner } from "../../tools/system/process-runner.js";

export type CoreModule = {
  config: KaelConfig;
  sessions: SessionStore;
  jobs: JobService;
};

export async function bootstrapCoreModule(): Promise<CoreModule> {
  const config = await loadConfig();
  const sessions = new SessionStore(config.dataDir);
  const jobStore = new JobStore(config.dataDir);

  await sessions.init();
  await jobStore.init();

  const runner = new LocalProcessRunner();
  const supervisor = new LocalProcessSupervisor(runner);
  const jobs = new JobService(jobStore, supervisor, {
    maxConcurrentJobs: config.execution.maxConcurrentJobs,
    jobTimeoutMs: config.execution.jobTimeoutMs,
    killGraceMs: config.execution.killGraceMs,
  });

  return {
    config,
    sessions,
    jobs,
  };
}
