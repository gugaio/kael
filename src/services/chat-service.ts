import type { AgentEngine } from "../engine/types.js";
import type { JobManager } from "../jobs/manager.js";
import type { SessionStore } from "../session/store.js";
import type { SessionMessage } from "../types.js";

export class ChatService {
  constructor(
    private readonly sessions: SessionStore,
    private readonly jobs: JobManager,
    private readonly engine: AgentEngine,
  ) {}

  async handleMessage(input: {
    sessionKey: string;
    message: string;
  }): Promise<{ user: SessionMessage; assistant: SessionMessage; reply: string }> {
    const user = await this.sessions.appendMessage(input.sessionKey, "user", input.message);

    const turn = await this.engine.runTurn({
      sessionKey: input.sessionKey,
      message: input.message,
      tooling: {
        startTranscode: (params) => this.jobs.startTranscode(params),
        startConvertHls: (params) => this.jobs.startConvertHls(params),
        startCaptureStream: (params) => this.jobs.startCaptureStream(params),
        startProbeMedia: (params) => this.jobs.startProbeMedia(params),
        listJobs: () =>
          this.jobs.listJobs().map((job) => ({
            id: job.id,
            status: job.status,
            type: job.type,
            output: job.output,
          })),
      },
    });

    const assistant = await this.sessions.appendMessage(input.sessionKey, "assistant", turn.reply);

    return {
      user,
      assistant,
      reply: turn.reply,
    };
  }

  async getHistory(sessionKey: string, limit = 50): Promise<SessionMessage[]> {
    return this.sessions.getMessages(sessionKey, limit);
  }
}
