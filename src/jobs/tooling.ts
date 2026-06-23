import type { JobRecord } from "../types.js";

export type JobsListFilters = {
  sessionKey?: string;
  status?: string;
  limit?: number;
};

export type ListedJob = {
  id: string;
  status: string;
  output?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
};

function clampListLimit(limit: number | undefined): number {
  return Math.max(1, Math.floor(limit ?? 50));
}

export function mapJobForList(job: JobRecord): ListedJob {
  return {
    id: job.id,
    status: job.status,
    output: job.output,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    error: job.error,
  };
}

export function selectJobs(jobs: JobRecord[], filters: JobsListFilters = {}): ListedJob[] {
  const { sessionKey, status, limit } = filters;
  return jobs
    .filter((job) => (sessionKey ? job.sessionKey === sessionKey : true))
    .filter((job) => (status ? job.status === status : true))
    .slice(0, clampListLimit(limit))
    .map(mapJobForList);
}

export function buildJobLogTailResult(params: {
  jobId: string;
  text: string | null;
  tailChars?: number;
}): { jobId: string; found: boolean; log?: string } {
  const { jobId, text, tailChars } = params;
  if (text === null) {
    return { jobId, found: false };
  }
  if (typeof tailChars === "number" && Number.isFinite(tailChars) && tailChars > 0) {
    const size = Math.floor(tailChars);
    return {
      jobId,
      found: true,
      log: text.slice(-size),
    };
  }
  return { jobId, found: true, log: text };
}

export function formatJobsListText(jobs: ListedJob[]): string {
  if (jobs.length === 0) {
    return "jobs=0";
  }
  return [
    `jobs=${jobs.length}`,
    ...jobs.map((job) => `${job.id} | ${job.status} | createdAt=${job.createdAt}`),
  ].join("\n");
}

export function formatJobDetailsText(job: {
  id: string;
  status: string;
  sessionKey: string;
  command: string;
  input: string;
  output?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  error?: string;
}): string {
  return [
    "found=true",
    `jobId=${job.id}`,
    `status=${job.status}`,
    `sessionKey=${job.sessionKey}`,
    `command=${job.command}`,
    `input=${job.input}`,
    job.output ? `output=${job.output}` : "",
    `createdAt=${job.createdAt}`,
    job.startedAt ? `startedAt=${job.startedAt}` : "",
    job.endedAt ? `endedAt=${job.endedAt}` : "",
    job.exitCode !== undefined ? `exitCode=${String(job.exitCode)}` : "",
    job.error ? `error=${job.error}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatJobLogText(params: { jobId: string; log: string }): string {
  return ["found=true", `jobId=${params.jobId}`, `chars=${params.log.length}`, "log:", params.log].join("\n");
}
