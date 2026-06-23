import type { VideoJobs } from "../video/jobs.js";
import type { JobService } from "../jobs/service.js";
import type { ShellRuntime } from "../tools/system/shell-tool-service.js";

export type PlannerExecuteRuntime = {
  startProbeMedia: (args: { sessionKey: string; inputPath: string }) => Promise<{ id: string; status: string }>;
  startCaptureStream: (args: {
    sessionKey: string;
    streamUrl: string;
    outputPath: string;
    durationSeconds?: number;
  }) => Promise<{ id: string; status: string }>;
  startTranscode: (args: {
    sessionKey: string;
    inputPath: string;
    outputPath: string;
    args?: string[];
  }) => Promise<{ id: string; status: string }>;
  startConvertHls: (args: {
    sessionKey: string;
    inputPath: string;
    outputPlaylistPath: string;
    segmentTime?: number;
  }) => Promise<{ id: string; status: string }>;
  execCommand: (args: {
    sessionKey: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
    background?: boolean;
  }) => Promise<{
    id: string;
    status: string;
    command: string;
    cwd: string;
    outputTail?: string;
    exitCode?: number | null;
  }>;
  getJob: (jobId: string) => Promise<{ status: string; error?: string } | null>;
  pollExec: (sessionId: string) => Promise<{ status: string; message?: string } | null>;
  cancelJob: (jobId: string) => Promise<{ canceled: boolean; status?: string; message?: string }>;
  cancelExec: (sessionId: string) => Promise<{ canceled: boolean; status?: string; message?: string }>;
};

export type PlannerReconcileRuntime = {
  getJob: (jobId: string) => Promise<{ status: string; error?: string } | null>;
  pollExec: (sessionId: string) => Promise<{ status: string; message?: string } | null>;
};

type PlannerReadDeps = {
  jobs: JobService;
  shell: ShellRuntime;
};

type PlannerExecuteDeps = PlannerReadDeps & { videoJobs: VideoJobs };

export function createPlannerExecuteRuntime(
  deps: PlannerExecuteDeps,
  sessionKey = "planner.execute",
): PlannerExecuteRuntime {
  return {
    startProbeMedia: (args) => deps.videoJobs.startProbeMedia(args),
    startCaptureStream: (args) => deps.videoJobs.startCaptureStream(args),
    startTranscode: (args) => deps.videoJobs.startTranscode(args),
    startConvertHls: (args) => deps.videoJobs.startConvertHls(args),
    execCommand: (args) =>
      deps.shell.exec({
        sessionKey: args.sessionKey,
        command: args.command,
        cwd: args.cwd,
        timeoutMs: args.timeoutMs,
        background: args.background,
      }),
    getJob: async (jobId: string) => {
      const found = deps.jobs.getJob(jobId);
      if (!found) {
        return null;
      }
      return {
        status: found.status,
        error: found.error,
      };
    },
    pollExec: async (sessionId: string) => {
      const poll = await deps.shell.process({
        sessionKey,
        action: "poll",
        sessionId,
      });
      if (!poll.ok || !poll.session) {
        return null;
      }
      return {
        status: poll.session.status,
        message: poll.message,
      };
    },
    cancelJob: async (jobId: string) => {
      const result = await deps.jobs.cancelJob(jobId);
      return {
        canceled: result.canceled,
        status: result.job?.status,
        message: result.canceled ? undefined : "job cancel not accepted",
      };
    },
    cancelExec: async (sessionId: string) => {
      const result = await deps.shell.process({
        sessionKey,
        action: "kill",
        sessionId,
      });
      return {
        canceled: result.ok,
        status: result.session?.status,
        message: result.message,
      };
    },
  };
}

export function createPlannerReconcileRuntime(
  deps: PlannerReadDeps,
  sessionKey = "planner.reconcile",
): PlannerReconcileRuntime {
  return {
    getJob: async (jobId: string) => {
      const found = deps.jobs.getJob(jobId);
      if (!found) {
        return null;
      }
      return {
        status: found.status,
        error: found.error,
      };
    },
    pollExec: async (sessionId: string) => {
      const poll = await deps.shell.process({
        sessionKey,
        action: "poll",
        sessionId,
      });
      if (!poll.ok || !poll.session) {
        return null;
      }
      return {
        status: poll.session.status,
        message: poll.message,
      };
    },
  };
}
