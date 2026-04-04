import type { EngineToolingNamespaces } from "../engine/types.js";
import type { JobManager } from "../jobs/manager.js";
import { VIDEO_JOB_ACTIONS } from "../capabilities/video/index.js";
import type { MemoryService } from "../memory/service.js";
import type { KnowledgeService } from "../knowledge/service.js";
import type { PlannerService } from "../planner/service.js";
import type { ProjectContextService } from "../projects/service.js";
import { createPlannerExecuteRuntime, createPlannerReconcileRuntime } from "../planner/runtime.js";
import type { ResearchService } from "../research/service.js";
import type { ImageGeneratorService } from "../media/image-generator.js";
import type { ShellRuntime } from "../tools/system/shell-tool-service.js";
import type { McpRuntime } from "../tools/mcp/mcp-bridge-service.js";
import type { VideoInspectToolService } from "../capabilities/video/index.js";
import type {
  PlaybackTriageService,
  ProviderBackedVideoGenerationService,
  VideoManifestAuditService,
  VideoManifestDiffService,
} from "../capabilities/video/index.js";
import type { WorkspaceInspector } from "../workspace/inspector.js";
import type { BrowserRuntime } from "../runtime/browser/index.js";
import { buildJobLogTailResult, selectJobs } from "../jobs/tooling.js";
import type { EdgeRuntime } from "../edge/runtime.js";

type ChatToolingExecutors = {
  jobManager: JobManager;
  shellRuntime: ShellRuntime;
  mcpRuntime: McpRuntime;
  edgeRuntime: EdgeRuntime;
  videoInspect: VideoInspectToolService;
  memory: MemoryService;
  knowledge: KnowledgeService;
  projects: ProjectContextService;
  workspace: WorkspaceInspector;
  research: ResearchService;
  planner: PlannerService;
  imageGenerator: ImageGeneratorService;
  videoGeneration: ProviderBackedVideoGenerationService;
  playbackTriage: PlaybackTriageService;
  manifestAudit: VideoManifestAuditService;
  manifestDiff: VideoManifestDiffService;
  browserRuntime: BrowserRuntime;
};

export function createChatTooling(executors: ChatToolingExecutors): EngineToolingNamespaces {
  return {
    video: {
      startTranscode: (params) => executors.jobManager.startAction(VIDEO_JOB_ACTIONS.transcode, params),
      startConvertHls: (params) => executors.jobManager.startAction(VIDEO_JOB_ACTIONS.convertHls, params),
      startCaptureStream: (params) => executors.jobManager.startAction(VIDEO_JOB_ACTIONS.captureStream, params),
      startProbeMedia: (params) => executors.jobManager.startAction(VIDEO_JOB_ACTIONS.probeMedia, params),
      startPlayVlc: (params) => executors.jobManager.startAction(VIDEO_JOB_ACTIONS.playVlc, params),
      videoHlsInspect: async ({ url, maxSegments, timeoutMs }) =>
        executors.videoInspect.inspectHls({ url, maxSegments, timeoutMs }),
      videoProbe: async ({ input, timeoutMs, keyframes, maxKeyframes, streamSelector }) =>
        executors.videoInspect.probe({ input, timeoutMs, keyframes, maxKeyframes, streamSelector }),
      videoManifestAudit: async ({ url, maxSegments, timeoutMs, followVariants, maxVariants, sessionKey }) =>
        executors.manifestAudit.auditHlsManifest({
          sessionKey,
          url,
          maxSegments,
          timeoutMs,
          followVariants,
          maxVariants,
        }),
      videoManifestDiff: async ({ leftUrl, rightUrl, maxSegments, timeoutMs, followVariants, maxVariants, sessionKey }) =>
        executors.manifestDiff.diffHlsManifests({
          sessionKey,
          leftUrl,
          rightUrl,
          maxSegments,
          timeoutMs,
          followVariants,
          maxVariants,
        }),
      videoGenerateImage: ({ sessionKey, prompt, provider, size }) =>
        executors.videoGeneration.generateImage({ sessionKey, prompt, provider, size }),
      playbackAnalyze: async ({ sessionKey, player, source, streamUrl, logText, events }) =>
        executors.playbackTriage.analyzeSession({ sessionKey, player, source, streamUrl, logText, events }),
    },
    jobs: {
      listJobs: ({ sessionKey, capability, action, status, limit } = {}) =>
        selectJobs(executors.jobManager.listJobs(), { sessionKey, capability, action, status, limit }),
      getJob: ({ jobId }) => executors.jobManager.getJob(jobId),
      getJobLog: async ({ jobId, tailChars }) => {
        const text = await executors.jobManager.getJobLog(jobId);
        return buildJobLogTailResult({ jobId, text, tailChars });
      },
    },
    system: {
      execCommand: (params) => executors.shellRuntime.exec(params),
      processCommand: (params) => executors.shellRuntime.process(params),
    },
    mcp: {
      mcpList: ({ sessionKey, server, schema, timeoutMs }) =>
        executors.mcpRuntime.list({ sessionKey, server, schema, timeoutMs }),
      mcpCall: ({ sessionKey, target, argumentsJson, stdioCommand, timeoutMs }) =>
        executors.mcpRuntime.call({ sessionKey, target, argumentsJson, stdioCommand, timeoutMs }),
    },
    edge: {
      edgeList: ({ clientId, capability } = {}) =>
        executors.edgeRuntime
          .listCapabilities()
          .filter((item) => (clientId ? item.clientId === clientId : true))
          .filter((item) => (capability ? item.name === capability : true)),
      edgeCall: ({ capability, input, clientId, timeoutMs }) =>
        executors.edgeRuntime.dispatchTask({ capability, input, clientId, timeoutMs }),
      youboraMetricsGet: ({ fromDate, toDate, metrics, type, granularity, filters, clientId, timeoutMs }) =>
        executors.edgeRuntime.dispatchTask({
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
        executors.edgeRuntime.dispatchTask({
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
        executors.edgeRuntime.dispatchTask({
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
      memorySearch: ({ query, maxResults }) => executors.memory.search(query, maxResults),
      memoryGet: ({ path, from, lines }) => executors.memory.get({ relPath: path, from, lines }),
      memoryWrite: ({ content, target }) => executors.memory.write({ content, target }),
    },
    knowledge: {
      knowledgeSearch: ({ query, project, kind, tag, status, maxResults }) =>
        executors.knowledge.search({ query, project, kind, tag, status, maxResults }),
      knowledgeGet: ({ noteId }) => executors.knowledge.get(noteId),
      knowledgeUpsert: (params) => executors.knowledge.upsert(params),
    },
    projects: {
      projectSearch: ({ query, project, maxResults }) => executors.projects.search({ query, project, maxResults }),
      projectGetDocument: ({ project, path }) => executors.projects.getDocument(project, path),
      projectUpsertDocument: (params) => executors.projects.upsertDocument(params),
      projectListDocuments: ({ project }) => executors.projects.listDocuments(project),
    },
    workspace: {
      workspaceSearch: ({ query, maxResults }) => executors.workspace.search({ query, maxResults }),
      workspaceRead: ({ path, from, lines }) => executors.workspace.read({ relPath: path, from, lines }),
    },
    web: {
      webSearch: ({ sessionKey, query, maxResults, recencyDays, domainsAllow, domainsBlock, signal }) =>
        executors.research.search({
          sessionKey,
          query,
          maxResults,
          recencyDays,
          domainsAllow,
          domainsBlock,
          signal,
        }),
      webFetch: ({ sessionKey, url, maxChars, signal }) =>
        executors.research.fetchUrl({
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
        executors.research.research({
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
        executors.browserRuntime.command({
          sessionKey,
          action,
          targetId,
          url,
          selector,
          text,
          key,
          timeoutMs,
        }),
      browserRuntimeTelemetry: () => executors.browserRuntime.getRuntimeTelemetrySnapshot(),
    },
    image: {
      imageGenerate: ({ prompt, size }) => executors.imageGenerator.generate({ prompt, size }),
    },
    plans: {
      planCreate: ({ sessionKey, title, steps }) => executors.planner.create({ sessionKey, title, steps }),
      planGenerate: ({ sessionKey, objective, maxSteps }) =>
        executors.planner.generate({ sessionKey, objective, maxSteps }),
      planList: ({ sessionKey, status, limit }) => executors.planner.list({ sessionKey, status, limit }),
      planGet: ({ planId }) => executors.planner.get(planId),
      planUpdateStep: ({ planId, stepIndex, status, notes }) =>
        executors.planner.updateStep({ planId, stepIndex, status, notes }),
      planNextAction: ({ planId }) => executors.planner.nextAction(planId),
      planExecuteNext: ({ planId, inputs }) =>
        executors.planner.executeNext({
          planId,
          inputs,
          runtime: createPlannerExecuteRuntime({
            jobs: executors.jobManager,
            shell: executors.shellRuntime,
          }),
        }),
      planReconcile: ({ planId, limit }) =>
        executors.planner.reconcile({
          planId,
          limit,
          runtime: createPlannerReconcileRuntime({
            jobs: executors.jobManager,
            shell: executors.shellRuntime,
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
      videoManifestAudit: async () => {
        throw new Error("chat-only mode: video_manifest_audit disabled");
      },
      videoManifestDiff: async () => {
        throw new Error("chat-only mode: video_manifest_diff disabled");
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
    knowledge: {
      knowledgeSearch: async () => [],
      knowledgeGet: async () => null,
      knowledgeUpsert: async () => {
        throw new Error("chat-only mode: knowledge_upsert disabled");
      },
    },
    projects: {
      projectSearch: async () => [],
      projectGetDocument: async () => null,
      projectUpsertDocument: async () => {
        throw new Error("chat-only mode: project_upsert_document disabled");
      },
      projectListDocuments: async () => [],
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
