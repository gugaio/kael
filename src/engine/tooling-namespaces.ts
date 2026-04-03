import type { EngineTooling } from "./types.js";

export type EngineToolingNamespaces = {
  video: Pick<
    EngineTooling,
    | "startTranscode"
    | "startConvertHls"
    | "startCaptureStream"
    | "startProbeMedia"
    | "startPlayVlc"
    | "videoHlsInspect"
    | "videoProbe"
    | "videoGenerateImage"
    | "playbackAnalyze"
  >;
  jobs: Pick<EngineTooling, "listJobs" | "getJob" | "getJobLog">;
  system: Pick<EngineTooling, "execCommand" | "processCommand">;
  mcp: Pick<EngineTooling, "mcpList" | "mcpCall">;
  edge: Pick<
    EngineTooling,
    "edgeList" | "edgeCall" | "youboraMetricsGet" | "youboraRawdataGet" | "youboraEventsGet"
  >;
  memory: Pick<EngineTooling, "memorySearch" | "memoryGet" | "memoryWrite">;
  workspace: Pick<EngineTooling, "workspaceSearch" | "workspaceRead">;
  web: Pick<EngineTooling, "webSearch" | "webFetch" | "webResearch">;
  browser: Pick<EngineTooling, "browserCommand" | "browserRuntimeTelemetry">;
  image: Pick<EngineTooling, "imageGenerate">;
  plans: Pick<
    EngineTooling,
    | "planCreate"
    | "planGenerate"
    | "planList"
    | "planGet"
    | "planUpdateStep"
    | "planNextAction"
    | "planExecuteNext"
    | "planReconcile"
  >;
};

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
