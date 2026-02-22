import type { EngineTooling } from "../engine/types.js";
import { normalizePiError } from "../engine/pi-errors.js";
import type { JobManager } from "../jobs/manager.js";
import type { MemoryService } from "../memory/service.js";
import type { PlannerService } from "../planner/service.js";
import type { ResearchService } from "../research/service.js";
import type { SessionStore } from "../session/store.js";
import type { ShellToolService } from "../tools/system/shell-tool-service.js";
import type { VideoInspectToolService } from "../tools/video/video-inspect-tool-service.js";
import type { SessionMessage } from "../types.js";
import type { WorkspaceInspector } from "../workspace/inspector.js";
import { TurnOrchestrator } from "./turn-orchestrator.js";

function shouldResetSessionOnEngineError(error: unknown): boolean {
  const normalized = normalizePiError(error);
  return normalized.code === "invalid_response" || normalized.code === "unknown";
}

function extractPlayVlcUrl(reply: string): string | null {
  const text = reply.trim();
  const quoted = text.match(/^\/playvlc\s+["'](.+?)["']\s*$/i);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }
  const bare = text.match(/^\/playvlc\s+(\S+)\s*$/i);
  if (bare?.[1]) {
    return bare[1].trim();
  }
  return null;
}

function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export class ChatService {
  private readonly tooling: EngineTooling;
  private readonly chatOnlyTooling: EngineTooling;

  constructor(
    private readonly sessions: SessionStore,
    private readonly jobs: JobManager,
    private readonly shell: ShellToolService,
    private readonly videoInspect: VideoInspectToolService,
    private readonly memory: MemoryService,
    private readonly workspace: WorkspaceInspector,
    private readonly research: ResearchService,
    private readonly planner: PlannerService,
    private readonly orchestrator: TurnOrchestrator,
  ) {
    this.tooling = {
      startTranscode: (params) => this.jobs.startTranscode(params),
      startConvertHls: (params) => this.jobs.startConvertHls(params),
      startCaptureStream: (params) => this.jobs.startCaptureStream(params),
      startProbeMedia: (params) => this.jobs.startProbeMedia(params),
      videoHlsInspect: async ({ url, maxSegments, timeoutMs }) =>
        this.videoInspect.inspectHls({ url, maxSegments, timeoutMs }),
      videoProbe: async ({ input, timeoutMs, keyframes, maxKeyframes, streamSelector }) =>
        this.videoInspect.probe({ input, timeoutMs, keyframes, maxKeyframes, streamSelector }),
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
      workspaceSearch: ({ query, maxResults }) => this.workspace.search({ query, maxResults }),
      workspaceRead: ({ path, from, lines }) => this.workspace.read({ relPath: path, from, lines }),
      webSearch: ({ sessionKey, query, maxResults, recencyDays, domainsAllow, domainsBlock }) =>
        this.research.search({
          sessionKey,
          query,
          maxResults,
          recencyDays,
          domainsAllow,
          domainsBlock,
        }),
      webFetch: ({ sessionKey, url, maxChars }) =>
        this.research.fetchUrl({
          sessionKey,
          url,
          maxChars,
        }),
      webResearch: ({
        sessionKey,
        query,
        maxResults,
        fetchTop,
        fetchMaxChars,
        recencyDays,
        domainsAllow,
        domainsBlock,
      }) =>
        this.research.research({
          sessionKey,
          query,
          maxResults,
          fetchTop,
          fetchMaxChars,
          recencyDays,
          domainsAllow,
          domainsBlock,
        }),
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
    this.chatOnlyTooling = {
      ...this.tooling,
      startTranscode: async () => {
        throw new Error("chat-only mode: transcode disabled");
      },
      startConvertHls: async () => {
        throw new Error("chat-only mode: convert_hls disabled");
      },
      startCaptureStream: async () => {
        throw new Error("chat-only mode: capture_stream disabled");
      },
      startProbeMedia: async () => {
        throw new Error("chat-only mode: probe_media job disabled");
      },
      videoHlsInspect: async () => {
        throw new Error("chat-only mode: video_hls_inspect disabled");
      },
      videoProbe: async () => {
        throw new Error("chat-only mode: video_probe disabled");
      },
      listJobs: () => [],
      execCommand: async () => {
        throw new Error("chat-only mode: exec disabled");
      },
      processCommand: async () => {
        throw new Error("chat-only mode: process disabled");
      },
      planCreate: async () => {
        throw new Error("chat-only mode: plan_create disabled");
      },
      planGenerate: async () => {
        throw new Error("chat-only mode: plan_generate disabled");
      },
      planList: () => [],
      planUpdateStep: async () => {
        throw new Error("chat-only mode: plan_update_step disabled");
      },
      planNextAction: () => null,
      planExecuteNext: async () => {
        throw new Error("chat-only mode: plan_execute_next disabled");
      },
      planReconcile: async () => {
        throw new Error("chat-only mode: plan_reconcile disabled");
      },
    };
  }

  async handleMessage(input: {
    sessionKey: string;
    message: string;
    requestId?: string;
  }): Promise<{ user: SessionMessage; assistant: SessionMessage; reply: string }> {
    return this.handleMessageInternal(input, this.tooling, { allowPlayVlcShortcut: true });
  }

  async handleMessageChatOnly(input: {
    sessionKey: string;
    message: string;
    requestId?: string;
  }): Promise<{ user: SessionMessage; assistant: SessionMessage; reply: string }> {
    return this.handleMessageInternal(input, this.chatOnlyTooling, { allowPlayVlcShortcut: false });
  }

  private async handleMessageInternal(
    input: {
      sessionKey: string;
      message: string;
      requestId?: string;
    },
    tooling: EngineTooling,
    opts: { allowPlayVlcShortcut: boolean },
  ): Promise<{ user: SessionMessage; assistant: SessionMessage; reply: string }> {
    let user = await this.sessions.appendMessage(input.sessionKey, "user", input.message);

    try {
      const turn = await this.orchestrator.run({
        sessionKey: input.sessionKey,
        message: input.message,
        requestId: input.requestId,
        tooling,
      });
      let reply = turn.reply;
      const playVlcUrl = opts.allowPlayVlcShortcut ? extractPlayVlcUrl(turn.reply) : null;
      if (playVlcUrl) {
        const exec = await this.shell.exec({
          sessionKey: input.sessionKey,
          command: `vlc ${shellQuoteSingle(playVlcUrl)}`,
          background: true,
          timeoutMs: 120_000,
        });
        reply = [
          `Comando executado via tool exec.`,
          `session=${exec.id}`,
          `status=${exec.status}`,
          `command=${exec.command}`,
          exec.outputTail?.trim() ? `output:\n${exec.outputTail}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }

      const assistant = await this.sessions.appendMessage(input.sessionKey, "assistant", reply);

      return {
        user,
        assistant,
        reply,
      };
    } catch (error) {
      const normalized = normalizePiError(error);
      if (normalized.code === "timeout") {
        const sessions = await this.shell.process({
          sessionKey: input.sessionKey,
          action: "list",
        });
        const recent = (sessions.sessions ?? []).slice(-3);
        const lines = recent.map((item) => {
          const exit = item.exitCode == null ? "n/a" : String(item.exitCode);
          return `- ${item.status} (exit=${exit}) :: ${item.command}`;
        });
        const reply = [
          "A execucao demorou demais e foi interrompida para evitar loop de ferramentas.",
          normalized.message ? `Motivo: ${normalized.message}` : "",
          lines.length > 0 ? "Ultimas execucoes shell observadas:" : "",
          ...lines,
          "Se quiser, posso continuar de forma mais objetiva com um comando por vez.",
        ]
          .filter(Boolean)
          .join("\n");
        const assistant = await this.sessions.appendMessage(input.sessionKey, "assistant", reply);
        return {
          user,
          assistant,
          reply,
        };
      }

      if (!shouldResetSessionOnEngineError(error)) {
        throw error;
      }

      // Falha irrecuperavel: recria sessao e tenta novamente uma vez sem historico antigo.
      await this.sessions.resetSession(input.sessionKey);
      user = await this.sessions.appendMessage(input.sessionKey, "user", input.message);
      const turn = await this.orchestrator.run({
        sessionKey: input.sessionKey,
        message: input.message,
        requestId: input.requestId,
        tooling,
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
