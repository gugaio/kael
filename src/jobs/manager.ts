import fs from "node:fs/promises";
import type { JobRecord, JobStatus } from "../types.js";
import type { JobStore } from "./store.js";
import type { JobActionHandler, JobCapability } from "./capabilities.js";

export class JobManager {
  private readonly capabilitiesByName: Map<string, JobCapability> = new Map();
  private readonly actionHandlers: Map<string, { capability: string; handler: JobActionHandler }> = new Map();

  constructor(
    private readonly store: JobStore,
    capabilities: JobCapability[],
  ) {
    for (const capability of capabilities) {
      if (this.capabilitiesByName.has(capability.name)) {
        throw new Error(`duplicate job capability name: ${capability.name}`);
      }
      this.capabilitiesByName.set(capability.name, capability);
      for (const [actionName, handler] of Object.entries(capability.actions)) {
        if (this.actionHandlers.has(actionName)) {
          throw new Error(`duplicate job action registered: ${actionName}`);
        }
        this.actionHandlers.set(actionName, { capability: capability.name, handler });
      }
    }
  }

  listJobs(): JobRecord[] {
    return this.store.list();
  }

  getStatusCounts(): Record<JobStatus, number> {
    return this.store.getStatusCounts();
  }

  getRuntimeStats(): { activeJobs: number; queuedJobs: number; maxConcurrentJobs: number } {
    let activeJobs = 0;
    let queuedJobs = 0;
    let maxConcurrentJobs = 0;
    for (const capability of this.capabilitiesByName.values()) {
      const stats = capability.getRuntimeStats?.();
      if (!stats) {
        continue;
      }
      activeJobs += stats.activeJobs;
      queuedJobs += stats.queuedJobs;
      maxConcurrentJobs += stats.maxConcurrentJobs;
    }
    return { activeJobs, queuedJobs, maxConcurrentJobs };
  }

  getJob(jobId: string): JobRecord | null {
    return this.store.get(jobId);
  }

  async getJobLog(jobId: string): Promise<string | null> {
    const job = this.store.get(jobId);
    if (!job) {
      return null;
    }
    return fs.readFile(job.logPath, "utf-8").catch(() => "");
  }

  async startAction(actionName: string, params: unknown): Promise<JobRecord> {
    const registration = this.actionHandlers.get(actionName);
    if (!registration) {
      throw new Error(`no capability registered for action: ${actionName}`);
    }
    return registration.handler(params);
  }

  async cancelJob(jobId: string): Promise<{ job: JobRecord | null; canceled: boolean }> {
    const job = this.store.get(jobId);
    if (!job) {
      return { job: null, canceled: false };
    }
    const registration = this.actionHandlers.get(job.action);
    if (!registration) {
      return { job, canceled: false };
    }
    const capability = this.capabilitiesByName.get(registration.capability);
    if (!capability) {
      return { job, canceled: false };
    }
    return capability.cancelJob(jobId);
  }

}
