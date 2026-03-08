import type { JobRecord } from "../types.js";

export type JobRuntimeStats = {
  activeJobs: number;
  queuedJobs: number;
  maxConcurrentJobs: number;
};

export type JobActionHandler = (params: unknown) => Promise<JobRecord>;

export type JobCapability = {
  name: string;
  actions: Record<string, JobActionHandler>;
  cancelJob: (jobId: string) => Promise<{ job: JobRecord | null; canceled: boolean }>;
  getRuntimeStats?: () => JobRuntimeStats;
};
