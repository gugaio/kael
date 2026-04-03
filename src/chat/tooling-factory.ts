import type { EngineToolingNamespaces } from "../engine/types.js";
import type { JobManager } from "../jobs/manager.js";
import { VIDEO_JOB_ACTIONS } from "../capabilities/video/index.js";
import type { MemoryService } from "../memory/service.js";
import type { PlannerService } from "../planner/service.js";
import { createPlannerExecuteRuntime, createPlannerReconcileRuntime } from "../planner/runtime.js";
import type { ResearchService } from "../research/service.js";
import type { ImageGeneratorService } from "../media/image-generator.js";
import type { ShellRuntime } from "../tools/system/shell-tool-service.js";
import type { McpRuntime } from "../tools/mcp/mcp-bridge-service.js";
import type { VideoInspectToolService } from "../capabilities/video/index.js";
import type {
  PlaybackTriageService,
  ProviderBackedVideoGenerationService,
} from "../capabilities/video/index.js";
import type { WorkspaceInspector } from "../workspace/inspector.js";
import type { BrowserCapability } from "../capabilities/browser/index.js";
import { buildJobLogTailResult, selectJobs } from "../jobs/tooling.js";
import type { EdgeRuntime } from "../edge/runtime.js";

type ChatToolingDeps = {
  jobs: JobManager;
  shell: ShellRuntime;
  mcp: McpRuntime;
  edge: EdgeRuntime;
  videoInspect: VideoInspectToolService;
  memory: MemoryService;
  workspace: WorkspaceInspector;
  research: ResearchService;
  planner: PlannerService;
  imageGenerator: ImageGeneratorService;
  videoGeneration: ProviderBackedVideoGenerationService;
  playbackTriage: PlaybackTriageService;
  browser: BrowserCapability;
};

export function createChatTooling(deps: ChatToolingDeps): EngineToolingNamespaces {
  return {
    video: {
      startTranscode: (params) => deps.jobs.startAction(VIDEO_JOB_ACTIONS.transcode, params),
      startConvertHls: (params) => deps.jobs.startAction(VIDEO_JOB_ACTIONS.convertHls, params),
      startCaptureStream: (params) => deps.jobs.startAction(VIDEO_JOB_ACTIONS.captureStream, params),
      startProbeMedia: (params) => deps.jobs.startAction(VIDEO_JOB_ACTIONS.probeMedia, params),
      startPlayVlc: (params) => deps.jobs.startAction(VIDEO_JOB_ACTIONS.playVlc, params),
      videoHlsInspect: async ({ url, maxSegments, timeoutMs }) =>
        deps.videoInspect.inspectHls({ url, maxSegments, timeoutMs }),
      videoProbe: async ({ input, timeoutMs, keyframes, maxKeyframes, streamSelector }) =>
        deps.videoInspect.probe({ input, timeoutMs, keyframes, maxKeyframes, streamSelector }),
      videoGenerateImage: ({ sessionKey, prompt, provider, size }) =>
        deps.videoGeneration.generateImage({ sessionKey, prompt, provider, size }),
      playbackAnalyze: async ({ sessionKey, player, source, streamUrl, logText, events }) =>
        deps.playbackTriage.analyzeSession({ sessionKey, player, source, streamUrl, logText, events }),
    },
    jobs: {
      listJobs: ({ sessionKey, capability, action, status, limit } = {}) =>
        selectJobs(deps.jobs.listJobs(), { sessionKey, capability, action, status, limit }),
      getJob: ({ jobId }) => deps.jobs.getJob(jobId),
      getJobLog: async ({ jobId, tailChars }) => {
        const text = await deps.jobs.getJobLog(jobId);
        return buildJobLogTailResult({ jobId, text, tailChars });
      },
    },
    system: {
      execCommand: (params) => deps.shell.exec(params),
      processCommand: (params) => deps.shell.process(params),
    },
    mcp: {
      mcpList: ({ sessionKey, server, schema, timeoutMs }) =>
        deps.mcp.list({ sessionKey, server, schema, timeoutMs }),
      mcpCall: ({ sessionKey, target, argumentsJson, stdioCommand, timeoutMs }) =>
        deps.mcp.call({ sessionKey, target, argumentsJson, stdioCommand, timeoutMs }),
    },
    edge: {
      edgeList: ({ clientId, capability } = {}) =>
        deps.edge
          .listCapabilities()
          .filter((item) => (clientId ? item.clientId === clientId : true))
          .filter((item) => (capability ? item.name === capability : true)),
      edgeCall: ({ capability, input, clientId, timeoutMs }) =>
        deps.edge.dispatchTask({ capability, input, clientId, timeoutMs }),
      youboraMetricsGet: ({ fromDate, toDate, metrics, type, granularity, filters, clientId, timeoutMs }) =>
        deps.edge.dispatchTask({
          capability: "youbora.metrics.get",
          input: {
            fromDate,
            ...(toDate ? { toDate } : {}),
            ...(metrics ? { metrics } : {}),
            ...(type ? { type } : {}),
            ...(granularity ? { granularity } : {}),
            ...(filters !== undefined ? { filters } : {}),
          },
          clientId,
          timeoutMs,
        }),
      youboraRawdataGet: ({ fromDate, toDate, type, filters, clientId, timeoutMs }) =>
        deps.edge.dispatchTask({
          capability: "youbora.rawdata.get",
          input: {
            fromDate,
            ...(toDate ? { toDate } : {}),
            ...(type ? { type } : {}),
            ...(filters !== undefined ? { filters } : {}),
          },
          clientId,
          timeoutMs,
        }),
      youboraEventsGet: ({ fromDate, toDate, type, filters, clientId, timeoutMs }) =>
        deps.edge.dispatchTask({
          capability: "youbora.events.get",
          input: {
            fromDate,
            ...(toDate ? { toDate } : {}),
            ...(type ? { type } : {}),
            ...(filters !== undefined ? { filters } : {}),
          },
          clientId,
          timeoutMs,
        }),
    },
    memory: {
      memorySearch: ({ query, maxResults }) => deps.memory.search(query, maxResults),
      memoryGet: ({ path, from, lines }) => deps.memory.get({ relPath: path, from, lines }),
      memoryWrite: ({ content, target }) => deps.memory.write({ content, target }),
    },
    workspace: {
      workspaceSearch: ({ query, maxResults }) => deps.workspace.search({ query, maxResults }),
      workspaceRead: ({ path, from, lines }) => deps.workspace.read({ relPath: path, from, lines }),
    },
    web: {
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
    },
    browser: {
      browserCommand: ({ sessionKey, action, targetId, url, selector, text, key, timeoutMs }) =>
        deps.browser.executeAction(action, {
          sessionKey,
          targetId,
          url,
          selector,
          text,
          key,
          timeoutMs,
        }),
      browserRuntimeTelemetry: () => deps.browser.getRuntimeTelemetrySnapshot(),
    },
    image: {
      imageGenerate: ({ prompt, size }) => deps.imageGenerator.generate({ prompt, size }),
    },
    plans: {
      planCreate: ({ sessionKey, title, steps }) => deps.planner.create({ sessionKey, title, steps }),
      planGenerate: ({ sessionKey, objective, maxSteps }) =>
        deps.planner.generate({ sessionKey, objective, maxSteps }),
      planList: ({ sessionKey, status, limit }) => deps.planner.list({ sessionKey, status, limit }),
      planGet: ({ planId }) => deps.planner.get(planId),
      planUpdateStep: ({ planId, stepIndex, status, notes }) =>
        deps.planner.updateStep({ planId, stepIndex, status, notes }),
      planNextAction: ({ planId }) => deps.planner.nextAction(planId),
      planExecuteNext: ({ planId, inputs }) =>
        deps.planner.executeNext({
          planId,
          inputs,
          runtime: createPlannerExecuteRuntime({
            jobs: deps.jobs,
            shell: deps.shell,
          }),
        }),
      planReconcile: ({ planId, limit }) =>
        deps.planner.reconcile({
          planId,
          limit,
          runtime: createPlannerReconcileRuntime({
            jobs: deps.jobs,
            shell: deps.shell,
          }),
        }),
    },
  };
}

export function createChatOnlyTooling(tooling: EngineToolingNamespaces): EngineToolingNamespaces {
  const namespaces = tooling;
  return {
    ...namespaces,
    video: {
      ...namespaces.video,
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
      videoGenerateImage: async () => {
        throw new Error("chat-only mode: video_generate_image disabled");
      },
      playbackAnalyze: async () => {
        throw new Error("chat-only mode: playback_analyze disabled");
      },
    },
    jobs: {
      listJobs: () => [],
      getJob: () => null,
      getJobLog: async ({ jobId }) => ({ jobId, found: false }),
    },
    system: {
      execCommand: async () => {
        throw new Error("chat-only mode: exec disabled");
      },
      processCommand: async () => {
        throw new Error("chat-only mode: process disabled");
      },
    },
    mcp: {
      mcpList: async () => {
        throw new Error("chat-only mode: mcp_list disabled");
      },
      mcpCall: async () => {
        throw new Error("chat-only mode: mcp_call disabled");
      },
    },
    edge: {
      edgeList: () => [],
      edgeCall: async ({ capability }) => ({
      ok: false,
      taskId: "chat-only",
      capability,
      error: "chat-only mode: edge_call disabled",
      errorCode: "chat_only_disabled",
    }),
      youboraMetricsGet: async () => ({
      ok: false,
      taskId: "chat-only",
      capability: "youbora.metrics.get",
      error: "chat-only mode: youbora_metrics_get disabled",
      errorCode: "chat_only_disabled",
    }),
    youboraRawdataGet: async () => ({
      ok: false,
      taskId: "chat-only",
      capability: "youbora.rawdata.get",
      error: "chat-only mode: youbora_rawdata_get disabled",
      errorCode: "chat_only_disabled",
    }),
    youboraEventsGet: async () => ({
      ok: false,
      taskId: "chat-only",
      capability: "youbora.events.get",
      error: "chat-only mode: youbora_events_get disabled",
      errorCode: "chat_only_disabled",
    }),
    },
    browser: {
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
    },
    image: {
      imageGenerate: async () => {
        throw new Error("chat-only mode: image_generate disabled");
      },
    },
    plans: {
      planCreate: async () => {
        throw new Error("chat-only mode: plan_create disabled");
      },
      planGenerate: async () => {
        throw new Error("chat-only mode: plan_generate disabled");
      },
      planList: () => [],
      planGet: () => null,
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
    },
  };
}
