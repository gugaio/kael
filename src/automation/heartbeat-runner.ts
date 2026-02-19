import type { JobManager } from "../jobs/manager.js";
import type { SessionStore } from "../session/store.js";

type JobSnapshot = {
  status: string;
  type: string;
  sessionKey: string;
  output?: string;
};

function isRelevantStatus(status: string): boolean {
  return status === "succeeded" || status === "failed";
}

export class HeartbeatRunner {
  private readonly lastByJobId: Map<string, JobSnapshot> = new Map();
  private seeded = false;

  constructor(
    private readonly jobs: JobManager,
    private readonly sessions: SessionStore,
  ) {}

  async runOnce(): Promise<{ notifiedCount: number }> {
    const allJobs = this.jobs.listJobs();

    if (!this.seeded) {
      for (const job of allJobs) {
        this.lastByJobId.set(job.id, {
          status: job.status,
          type: job.type,
          sessionKey: job.sessionKey,
          output: job.output,
        });
      }
      this.seeded = true;
      return { notifiedCount: 0 };
    }

    let notifiedCount = 0;
    for (const job of allJobs) {
      const previous = this.lastByJobId.get(job.id);
      const current: JobSnapshot = {
        status: job.status,
        type: job.type,
        sessionKey: job.sessionKey,
        output: job.output,
      };
      this.lastByJobId.set(job.id, current);

      if (!previous || previous.status === current.status || !isRelevantStatus(current.status)) {
        continue;
      }

      const details = current.output ? ` output=${current.output}` : "";
      await this.sessions.appendMessage(
        job.sessionKey,
        "system",
        `[heartbeat] job ${job.id} (${job.type}) mudou ${previous.status} -> ${current.status}.${details}`,
      );
      notifiedCount += 1;
    }

    return { notifiedCount };
  }
}
