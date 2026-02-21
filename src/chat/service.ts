import type { EngineTooling } from "../engine/types.js";
import { normalizePiError } from "../engine/pi-errors.js";
import type { JobManager } from "../jobs/manager.js";
import type { MemoryService } from "../memory/service.js";
import type { PlannerService } from "../planner/service.js";
import type { SessionStore } from "../session/store.js";
import type { ShellToolService } from "../tools/system/shell-tool-service.js";
import type { SessionMessage } from "../types.js";
import { TurnOrchestrator } from "./turn-orchestrator.js";

function shouldResetSessionOnEngineError(error: unknown): boolean {
  const normalized = normalizePiError(error);
  return normalized.code === "invalid_response" || normalized.code === "unknown";
}

export class ChatService {
  private readonly tooling: EngineTooling;

  constructor(
    private readonly sessions: SessionStore,
    private readonly jobs: JobManager,
    private readonly shell: ShellToolService,
    private readonly memory: MemoryService,
    private readonly planner: PlannerService,
    private readonly orchestrator: TurnOrchestrator,
  ) {
    this.tooling = {
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
      execCommand: (params) => this.shell.exec(params),
      processCommand: (params) => this.shell.process(params),
      memorySearch: ({ query, maxResults }) => this.memory.search(query, maxResults),
      memoryGet: ({ path, from, lines }) => this.memory.get({ relPath: path, from, lines }),
      memoryWrite: ({ content, target }) => this.memory.write({ content, target }),
      planCreate: ({ sessionKey, title, steps }) => this.planner.create({ sessionKey, title, steps }),
      planGenerate: ({ sessionKey, objective, maxSteps }) =>
        this.planner.generate({ sessionKey, objective, maxSteps }),
      planList: ({ sessionKey, status, limit }) => this.planner.list({ sessionKey, status, limit }),
      planUpdateStep: ({ planId, stepIndex, status, notes }) =>
        this.planner.updateStep({ planId, stepIndex, status, notes }),
      planNextAction: ({ planId }) => this.planner.nextAction(planId),
      planExecuteNext: ({ planId, inputs }) =>
        this.planner.executeNext({
          planId,
          inputs,
          runtime: {
            startProbeMedia: (args) => this.jobs.startProbeMedia(args),
            startCaptureStream: (args) => this.jobs.startCaptureStream(args),
            startTranscode: (args) => this.jobs.startTranscode(args),
            startConvertHls: (args) => this.jobs.startConvertHls(args),
            execCommand: (args) => this.shell.exec(args),
          },
        }),
      planReconcile: ({ planId, limit }) =>
        this.planner.reconcile({
          planId,
          limit,
          runtime: {
            getJob: async (jobId) => {
              const found = this.jobs.getJob(jobId);
              if (!found) {
                return null;
              }
              return {
                status: found.status,
                error: found.error,
              };
            },
            pollExec: async (sessionId) => {
              const result = await this.shell.process({
                sessionKey: "planner.reconcile",
                action: "poll",
                sessionId,
              });
              if (!result.ok || !result.session) {
                return null;
              }
              return {
                status: result.session.status,
                message: result.message,
              };
            },
          },
        }),
    };
  }

  async handleMessage(input: {
    sessionKey: string;
    message: string;
  }): Promise<{ user: SessionMessage; assistant: SessionMessage; reply: string }> {
    let user = await this.sessions.appendMessage(input.sessionKey, "user", input.message);

    try {
      const turn = await this.orchestrator.run({
        sessionKey: input.sessionKey,
        message: input.message,
        tooling: this.tooling,
      });

      const assistant = await this.sessions.appendMessage(input.sessionKey, "assistant", turn.reply);

      return {
        user,
        assistant,
        reply: turn.reply,
      };
    } catch (error) {
      if (!shouldResetSessionOnEngineError(error)) {
        throw error;
      }

      // Falha irrecuperavel: recria sessao e tenta novamente uma vez sem historico antigo.
      await this.sessions.resetSession(input.sessionKey);
      user = await this.sessions.appendMessage(input.sessionKey, "user", input.message);
      const turn = await this.orchestrator.run({
        sessionKey: input.sessionKey,
        message: input.message,
        tooling: this.tooling,
      });
      const assistant = await this.sessions.appendMessage(input.sessionKey, "assistant", turn.reply);

      return {
        user,
        assistant,
        reply: turn.reply,
      };
    }
  }

  async getHistory(sessionKey: string, limit = 50): Promise<SessionMessage[]> {
    return this.sessions.getMessages(sessionKey, limit);
  }
}
