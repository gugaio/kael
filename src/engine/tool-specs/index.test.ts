import { describe, expect, it } from "vitest";
import { createPiNamespaceTools } from "./index.js";

describe("createPiNamespaceTools", () => {
  it("compoe tools por capability com nomes esperados", () => {
    const textResult = (text: string) => [{ type: "text" as const, text }];
    const logToolStart = () => "intent";
    const logToolEnd = () => {};
    const makeBlockedResult = () => ({
      content: textResult("blocked=true"),
      details: { blocked: true },
    });
    const reserveNone = () => null;

    const registry = createPiNamespaceTools({
      system: {
        sessionKey: "s1",
        tooling: {} as never,
        textResult,
        formatSession: () => "session=s1",
        makeBlockedResult,
        reserveExecCall: reserveNone,
        reserveProcessCall: reserveNone,
        logToolStart,
        logToolEnd,
      },
      video: {
        sessionKey: "s1",
        tooling: {} as never,
        textResult,
        reserveToolCall: () => null,
        logToolStart,
        logToolEnd,
      },
      jobs: {
        tooling: {} as never,
        textResult,
        reserveToolCall: () => null,
        logToolStart,
        logToolEnd,
      },
      knowledge: {
        tooling: {} as never,
        textResult,
        logToolStart,
        logToolEnd,
      },
      edge: {
        tooling: {} as never,
        textResult,
        makeBlockedResult,
        reserveEdgeCall: reserveNone,
        logToolStart,
        logToolEnd,
      },
      mcp: {
        sessionKey: "s1",
        tooling: {} as never,
        textResult,
        makeBlockedResult,
        reserveMcpCall: reserveNone,
        logToolStart,
        logToolEnd,
      },
      memory: {
        tooling: {} as never,
        textResult,
        logToolStart,
        logToolEnd,
      },
      workspace: {
        tooling: {} as never,
        textResult,
      },
      web: {
        sessionKey: "s1",
        tooling: {} as never,
        textResult,
        makeBlockedResult,
        reserveWebCall: () => null,
        logToolStart,
        logToolEnd,
      },
      browser: {
        sessionKey: "s1",
        tooling: {} as never,
        textResult,
        reserveBrowserCall: () => null,
        logToolStart,
        logToolEnd,
      },
      plans: {
        sessionKey: "s1",
        tooling: {} as never,
        textResult,
      },
      image: {
        sessionKey: "s1",
        tooling: {} as never,
        textResult,
        makeBlockedResult,
        reserveImageCall: reserveNone,
        logToolStart,
        logToolEnd,
      },
    });

    expect(registry.system.map((tool) => tool.name)).toEqual(["exec", "process"]);
    expect(registry.video.map((tool) => tool.name)).toEqual([
      "video_hls_inspect",
      "video_probe",
      "video_manifest_audit",
      "video_manifest_diff",
      "playback_analyze",
    ]);
    expect(registry.jobs.map((tool) => tool.name)).toEqual(["jobs_list", "jobs_get", "jobs_log_tail"]);
    expect(registry.knowledge.map((tool) => tool.name)).toEqual([
      "knowledge_search",
      "knowledge_get",
      "knowledge_upsert",
    ]);
    expect(registry.edge.map((tool) => tool.name)).toEqual([
      "edge_list",
      "edge_call",
      "youbora_metrics_get",
      "youbora_rawdata_get",
      "youbora_events_get",
    ]);
    expect(registry.mcp.map((tool) => tool.name)).toEqual(["mcp_list", "mcp_call"]);
    expect(registry.memory.map((tool) => tool.name)).toEqual(["memory_search", "memory_get", "memory_write"]);
    expect(registry.workspace.map((tool) => tool.name)).toEqual(["workspace_search", "workspace_read"]);
    expect(registry.web.map((tool) => tool.name)).toEqual(["web_search", "web_fetch", "web_research"]);
    expect(registry.browser.name).toBe("browser");
    expect(registry.plans.map((tool) => tool.name)).toEqual([
      "plan_create",
      "plan_generate",
      "plan_list",
      "plan_get",
      "plan_update_step",
      "plan_next",
      "plan_execute_next",
      "plan_reconcile",
    ]);
    expect(registry.image.name).toBe("image_generate");
  });
});
