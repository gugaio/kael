import type { EngineTooling, EngineToolingInput, EngineToolingNamespaces } from "./types.js";

export function isToolingNamespaced(tooling: EngineToolingInput): tooling is EngineToolingNamespaces {
  return "video" in tooling && "jobs" in tooling && "system" in tooling;
}

export function flattenToolingNamespaces(namespaces: EngineToolingNamespaces): EngineTooling {
  return {
    ...namespaces.video,
    ...namespaces.jobs,
    ...namespaces.system,
    ...namespaces.mcp,
    ...namespaces.edge,
    ...namespaces.memory,
    ...namespaces.workspace,
    ...namespaces.web,
    ...namespaces.browser,
    ...namespaces.image,
    ...namespaces.plans,
  };
}

export function resolveToolingNamespaces(tooling: EngineToolingInput): EngineToolingNamespaces {
  if (isToolingNamespaced(tooling)) {
    return tooling;
  }
  return {
    video: {
      startTranscode: tooling.startTranscode,
      startConvertHls: tooling.startConvertHls,
      startCaptureStream: tooling.startCaptureStream,
      startProbeMedia: tooling.startProbeMedia,
      startPlayVlc: tooling.startPlayVlc,
      videoHlsInspect: tooling.videoHlsInspect,
      videoProbe: tooling.videoProbe,
      videoGenerateImage: tooling.videoGenerateImage,
      playbackAnalyze: tooling.playbackAnalyze,
    },
    jobs: {
      listJobs: tooling.listJobs,
      getJob: tooling.getJob,
      getJobLog: tooling.getJobLog,
    },
    system: {
      execCommand: tooling.execCommand,
      processCommand: tooling.processCommand,
    },
    mcp: {
      mcpList: tooling.mcpList,
      mcpCall: tooling.mcpCall,
    },
    edge: {
      edgeList: tooling.edgeList,
      edgeCall: tooling.edgeCall,
      youboraMetricsGet: tooling.youboraMetricsGet,
      youboraRawdataGet: tooling.youboraRawdataGet,
      youboraEventsGet: tooling.youboraEventsGet,
    },
    memory: {
      memorySearch: tooling.memorySearch,
      memoryGet: tooling.memoryGet,
      memoryWrite: tooling.memoryWrite,
    },
    workspace: {
      workspaceSearch: tooling.workspaceSearch,
      workspaceRead: tooling.workspaceRead,
    },
    web: {
      webSearch: tooling.webSearch,
      webFetch: tooling.webFetch,
      webResearch: tooling.webResearch,
    },
    browser: {
      browserCommand: tooling.browserCommand,
      browserRuntimeTelemetry: tooling.browserRuntimeTelemetry,
    },
    image: {
      imageGenerate: tooling.imageGenerate,
    },
    plans: {
      planCreate: tooling.planCreate,
      planGenerate: tooling.planGenerate,
      planList: tooling.planList,
      planGet: tooling.planGet,
      planUpdateStep: tooling.planUpdateStep,
      planNextAction: tooling.planNextAction,
      planExecuteNext: tooling.planExecuteNext,
      planReconcile: tooling.planReconcile,
    },
  };
}
