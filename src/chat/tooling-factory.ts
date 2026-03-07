import type { EngineTooling } from "../engine/types.js";
import type { JobManager } from "../jobs/manager.js";
import type { MemoryService } from "../memory/service.js";
import type { PlannerService } from "../planner/service.js";
import type { ResearchService } from "../research/service.js";
import type { ImageGeneratorService } from "../media/image-generator.js";
import type { ShellRuntime } from "../tools/system/shell-tool-service.js";
import type { VideoInspectToolService } from "../tools/video/video-inspect-tool-service.js";
import type { WorkspaceInspector } from "../workspace/inspector.js";
import type { BrowserRuntime } from "../tools/browser/service.js";

type ChatToolingDeps = {
  jobs: JobManager;
  shell: ShellRuntime;
  videoInspect: VideoInspectToolService;
  memory: MemoryService;
  workspace: WorkspaceInspector;
  research: ResearchService;
  planner: PlannerService;
  imageGenerator: ImageGeneratorService;
  browser: BrowserRuntime;
};

export function createChatTooling(deps: ChatToolingDeps): EngineTooling {
  return {
    startTranscode: (params) => deps.jobs.startTranscode(params),
    startConvertHls: (params) => deps.jobs.startConvertHls(params),
    startCaptureStream: (params) => deps.jobs.startCaptureStream(params),
    startProbeMedia: (params) => deps.jobs.startProbeMedia(params),
    startPlayVlc: (params) => deps.jobs.startPlayVlc(params),
    videoHlsInspect: async ({ url, maxSegments, timeoutMs }) =>
      deps.videoInspect.inspectHls({ url, maxSegments, timeoutMs }),
    videoProbe: async ({ input, timeoutMs, keyframes, maxKeyframes, streamSelector }) =>
      deps.videoInspect.probe({ input, timeoutMs, keyframes, maxKeyframes, streamSelector }),
    listJobs: () =>
      deps.jobs.listJobs().map((job) => ({
        id: job.id,
        status: job.status,
        type: job.type,
        output: job.output,
      })),
    execCommand: (params) => deps.shell.exec(params),
    processCommand: (params) => deps.shell.process(params),
    memorySearch: ({ query, maxResults }) => deps.memory.search(query, maxResults),
    memoryGet: ({ path, from, lines }) => deps.memory.get({ relPath: path, from, lines }),
    memoryWrite: ({ content, target }) => deps.memory.write({ content, target }),
    workspaceSearch: ({ query, maxResults }) => deps.workspace.search({ query, maxResults }),
    workspaceRead: ({ path, from, lines }) => deps.workspace.read({ relPath: path, from, lines }),
    webSearch: ({ sessionKey, query, maxResults, recencyDays, domainsAllow, domainsBlock, signal }) =>
      deps.research.search({
        sessionKey,
        query,
        maxResults,
        recencyDays,
        domainsAllow,
        domainsBlock,
        signal,
      }),
    webFetch: ({ sessionKey, url, maxChars, signal }) =>
      deps.research.fetchUrl({
        sessionKey,
        url,
        maxChars,
        signal,
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
      signal,
    }) =>
      deps.research.research({
        sessionKey,
        query,
        maxResults,
        fetchTop,
        fetchMaxChars,
        recencyDays,
        domainsAllow,
        domainsBlock,
        signal,
      }),
    browserCommand: ({ sessionKey, action, targetId, url, selector, text, key, timeoutMs }) =>
      deps.browser.command({
        sessionKey,
        action,
        targetId,
        url,
        selector,
        text,
        key,
        timeoutMs,
      }),
    browserRuntimeTelemetry: () => deps.browser.getRuntimeTelemetrySnapshot(),
    imageGenerate: ({ prompt, size }) => deps.imageGenerator.generate({ prompt, size }),
    planCreate: ({ sessionKey, title, steps }) => deps.planner.create({ sessionKey, title, steps }),
    planGenerate: ({ sessionKey, objective, maxSteps }) =>
      deps.planner.generate({ sessionKey, objective, maxSteps }),
    planList: ({ sessionKey, status, limit }) => deps.planner.list({ sessionKey, status, limit }),
    planUpdateStep: ({ planId, stepIndex, status, notes }) =>
      deps.planner.updateStep({ planId, stepIndex, status, notes }),
    planNextAction: ({ planId }) => deps.planner.nextAction(planId),
    planExecuteNext: ({ planId, inputs }) =>
      deps.planner.executeNext({
        planId,
        inputs,
        runtime: {
          startProbeMedia: (args) => deps.jobs.startProbeMedia(args),
          startCaptureStream: (args) => deps.jobs.startCaptureStream(args),
          startTranscode: (args) => deps.jobs.startTranscode(args),
          startConvertHls: (args) => deps.jobs.startConvertHls(args),
          execCommand: (args) => deps.shell.exec(args),
          getJob: async (jobId) => {
            const found = deps.jobs.getJob(jobId);
            if (!found) {
              return null;
            }
            return {
              status: found.status,
              error: found.error,
            };
          },
          pollExec: async (sessionId) => {
            const result = await deps.shell.process({
              sessionKey: "planner.execute",
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
          cancelJob: async (jobId) => {
            const result = await deps.jobs.cancelJob(jobId);
            return {
              canceled: result.canceled,
              status: result.job?.status,
              message: result.canceled ? undefined : "job cancel not accepted",
            };
          },
          cancelExec: async (sessionId) => {
            const result = await deps.shell.process({
              sessionKey: "planner.execute",
              action: "kill",
              sessionId,
            });
            return {
              canceled: result.ok,
              status: result.session?.status,
              message: result.message,
            };
          },
        },
      }),
    planReconcile: ({ planId, limit }) =>
      deps.planner.reconcile({
        planId,
        limit,
        runtime: {
          getJob: async (jobId) => {
            const found = deps.jobs.getJob(jobId);
            if (!found) {
              return null;
            }
            return {
              status: found.status,
              error: found.error,
            };
          },
          pollExec: async (sessionId) => {
            const result = await deps.shell.process({
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

export function createChatOnlyTooling(tooling: EngineTooling): EngineTooling {
  return {
    ...tooling,
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
    startPlayVlc: async () => {
      throw new Error("chat-only mode: play_vlc job disabled");
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
    browserCommand: async () => {
      throw new Error("chat-only mode: browser disabled");
    },
    browserRuntimeTelemetry: () => ({
      enabled: false,
      commands: 0,
      failures: 0,
      sessionsStarted: 0,
      sessionsClosed: 0,
      expiredSessionsClosed: 0,
      evictedSessions: 0,
      activeSessions: 0,
      actionCalls: {
        start: 0,
        open: 0,
        navigate: 0,
        snapshot_text: 0,
        screenshot: 0,
        click: 0,
        type: 0,
        press: 0,
        wait_for: 0,
        close: 0,
      },
      actionFailures: {
        start: 0,
        open: 0,
        navigate: 0,
        snapshot_text: 0,
        screenshot: 0,
        click: 0,
        type: 0,
        press: 0,
        wait_for: 0,
        close: 0,
      },
      avgLatencyMsByAction: {
        start: 0,
        open: 0,
        navigate: 0,
        snapshot_text: 0,
        screenshot: 0,
        click: 0,
        type: 0,
        press: 0,
        wait_for: 0,
        close: 0,
      },
    }),
    imageGenerate: async () => {
      throw new Error("chat-only mode: image_generate disabled");
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
