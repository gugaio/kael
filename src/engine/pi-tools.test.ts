import { describe, expect, it, vi } from "vitest";
import { createPiShellTools } from "./pi-tools.js";
import type { EngineTooling } from "./types.js";

function createTooling(overrides: Partial<EngineTooling> = {}): EngineTooling {
  return {
    ...overrides,
  } as EngineTooling;
}

describe("createPiShellTools image_generate", () => {
  it("returns failed result instead of throwing when generation errors", async () => {
    const tools = createPiShellTools({
      sessionKey: "s1",
      tooling: createTooling({
        imageGenerate: async () => {
          throw new Error("image backend timeout");
        },
      }),
    });
    const tool = tools.find((item) => item.name === "image_generate");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-1", { prompt: "dragao neon" });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");
    expect(text).toContain("ok=false");
    expect(text).toContain("reason=image_generate_failed");
    expect(text).toContain("image backend timeout");
  });

  it("blocks a second image generation call in same turn budget", async () => {
    const imageGenerate = vi.fn(async () => ({
      kind: "image" as const,
      dataBase64: "aGVsbG8=",
      mimeType: "image/png",
      fileName: "img.png",
    }));
    const tools = createPiShellTools({
      sessionKey: "s1",
      tooling: createTooling({
        imageGenerate,
      }),
    });
    const tool = tools.find((item) => item.name === "image_generate");
    expect(tool).toBeTruthy();

    const first = await tool!.execute("tc-1", { prompt: "primeira" });
    const second = await tool!.execute("tc-2", { prompt: "segunda" });

    const firstText = String((first.content?.[0] as { text?: unknown })?.text ?? "");
    const secondText = String((second.content?.[0] as { text?: unknown })?.text ?? "");

    expect(firstText).toContain("ok=true");
    expect(secondText).toContain("blocked=true");
    expect(secondText).toContain("image_generate_budget_exceeded:1/1");
    expect(imageGenerate).toHaveBeenCalledTimes(1);
  });
});

describe("createPiShellTools playback_analyze", () => {
  it("exposes playback_analyze and supports raw log text", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-playback",
      tooling: createTooling({
        playbackAnalyze: async ({ player, logText }) => ({
          ok: false,
          player,
          summary: "Analise detectou stall e erro fatal.",
          metrics: {
            eventCount: 4,
            errorCount: 1,
            fatalErrorCount: 1,
            rebufferCount: 2,
            startupTimeMs: 4200,
          },
          issues: [
            {
              code: "fatal_error",
              severity: "error",
              summary: "Sessao teve erro fatal.",
              evidence: [String(logText ?? "").slice(0, 30)],
            },
          ],
          recommendations: ["Cruzar logs com manifesto."],
        }),
      }),
    });
    const tool = tools.find((item) => item.name === "playback_analyze");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-playback", {
      player: "hlsjs",
      logText: "[4200ms] playing\n[9000ms] buffer stall\n[15000ms] fatal network error",
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");

    expect(text).toContain("ok=false");
    expect(text).toContain("player=hlsjs");
    expect(text).toContain("fatalErrors=1");
    expect(text).toContain("rebuffer=2");
    expect(text).toContain("fatal_error");
  });

  it("returns blocked result when playback tool is unavailable", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-playback-missing",
      tooling: createTooling({}),
    });
    const tool = tools.find((item) => item.name === "playback_analyze");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-playback", {
      player: "generic",
      logText: "fatal error",
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");
    expect(text).toContain("blocked=true");
    expect(text).toContain("playback_analyze_unavailable");
  });
});

describe("createPiShellTools browser budget", () => {
  it("bloqueia segunda chamada de browser quando maxBrowserCalls=1", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-browser",
      tooling: createTooling({
        browserCommand: async ({ action }) => ({
          ok: true,
          action,
          status: "started",
          message: "ok",
        }),
      }),
      budget: {
        maxToolCalls: 5,
        maxBrowserCalls: 1,
      },
    });
    const tool = tools.find((item) => item.name === "browser");
    expect(tool).toBeTruthy();

    const first = await tool!.execute("tc-1", { action: "start" });
    const second = await tool!.execute("tc-2", { action: "start" });

    const firstText = String((first.content?.[0] as { text?: unknown })?.text ?? "");
    const secondText = String((second.content?.[0] as { text?: unknown })?.text ?? "");

    expect(firstText).toContain("ok=true");
    expect(secondText).toContain("blocked=true");
    expect(secondText).toContain("browser_budget_exceeded:1/1");
  });
});

describe("createPiShellTools jobs/plans state tools", () => {
  it("exposes jobs_list and jobs_get using tooling state methods", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-jobs",
      tooling: createTooling({
        listJobs: () => [
          {
            id: "job-1",
            capability: "video",
            action: "transcode",
            status: "succeeded",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        getJob: () =>
          ({
            id: "job-1",
            capability: "video",
            action: "transcode",
            status: "succeeded",
            sessionKey: "s1",
            command: "ffmpeg",
            input: "/tmp/in.mp4",
            args: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            logPath: "/tmp/job-1.log",
          }) as never,
      }),
    });
    const listTool = tools.find((item) => item.name === "jobs_list");
    const getTool = tools.find((item) => item.name === "jobs_get");
    expect(listTool).toBeTruthy();
    expect(getTool).toBeTruthy();

    const listResult = await listTool!.execute("tc-list", {});
    const getResult = await getTool!.execute("tc-get", { jobId: "job-1" });
    const listText = String((listResult.content?.[0] as { text?: unknown })?.text ?? "");
    const getText = String((getResult.content?.[0] as { text?: unknown })?.text ?? "");

    expect(listText).toContain("jobs=1");
    expect(listText).toContain("video/transcode");
    expect(getText).toContain("found=true");
    expect(getText).toContain("jobId=job-1");
  });

  it("exposes plan_get and returns not found when plan is absent", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-plan",
      tooling: createTooling({
        planGet: () => null,
      }),
    });
    const planGetTool = tools.find((item) => item.name === "plan_get");
    expect(planGetTool).toBeTruthy();

    const result = await planGetTool!.execute("tc-plan", { planId: "plan-404" });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");
    expect(text).toContain("found=false");
  });
});

describe("createPiShellTools edge tools", () => {
  it("exposes edge_list and edge_call using tooling state methods", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-edge",
      tooling: createTooling({
        edgeList: () => [
          {
            clientId: "clark-1",
            clientName: "Clark 1",
            connectionId: "conn-1",
            name: "system.info",
            description: "Info",
            requiresApproval: false,
            providerNames: [],
            lastHeartbeatAt: null,
          },
        ],
        edgeCall: async () => ({
          ok: true,
          taskId: "task-1",
          clientId: "clark-1",
          connectionId: "conn-1",
          capability: "system.info",
          durationMs: 12,
          output: { hostname: "notebook" },
        }),
      }),
    });
    const listTool = tools.find((item) => item.name === "edge_list");
    const callTool = tools.find((item) => item.name === "edge_call");
    expect(listTool).toBeTruthy();
    expect(callTool).toBeTruthy();

    const listResult = await listTool!.execute("tc-list", {});
    const callResult = await callTool!.execute("tc-call", {
      capability: "system.info",
      inputJson: "{}",
    });
    const listText = String((listResult.content?.[0] as { text?: unknown })?.text ?? "");
    const callText = String((callResult.content?.[0] as { text?: unknown })?.text ?? "");

    expect(listText).toContain("count=1");
    expect(listText).toContain("system.info");
    expect(callText).toContain("ok=true");
    expect(callText).toContain("taskId=task-1");
    expect(callText).toContain("hostname");
  });

  it("blocks edge_call when edge turn budget is exhausted", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-edge-budget",
      tooling: createTooling({
        edgeCall: async () => ({
          ok: true,
          taskId: "task-1",
          capability: "system.info",
          output: {},
        }),
      }),
      budget: {
        maxToolCalls: 5,
        maxEdgeCalls: 1,
      },
    });
    const tool = tools.find((item) => item.name === "edge_call");
    expect(tool).toBeTruthy();

    const first = await tool!.execute("tc-1", { capability: "system.info" });
    const second = await tool!.execute("tc-2", { capability: "system.info" });

    const firstText = String((first.content?.[0] as { text?: unknown })?.text ?? "");
    const secondText = String((second.content?.[0] as { text?: unknown })?.text ?? "");
    expect(firstText).toContain("ok=true");
    expect(secondText).toContain("blocked=true");
    expect(secondText).toContain("edge_call_budget_exceeded:1/1");
  });
});

describe("createPiShellTools mcp tools", () => {
  it("exposes mcp_list and mcp_call using tooling state methods", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-mcp",
      tooling: createTooling({
        mcpList: async () => ({
          ok: true,
          command: "mcporter list --output json",
          schema: false,
          format: "json",
          items: [{ name: "linear" }],
        }),
        mcpCall: async () => ({
          ok: true,
          command: "mcporter call linear.list_issues --output json",
          target: "linear.list_issues",
          format: "json",
          output: { issues: [{ id: "1" }] },
        }),
      }),
    });
    const listTool = tools.find((item) => item.name === "mcp_list");
    const callTool = tools.find((item) => item.name === "mcp_call");
    expect(listTool).toBeTruthy();
    expect(callTool).toBeTruthy();

    const listResult = await listTool!.execute("tc-list", {});
    const callResult = await callTool!.execute("tc-call", {
      target: "linear.list_issues",
      argumentsJson: "{\"limit\":5}",
    });
    const listText = String((listResult.content?.[0] as { text?: unknown })?.text ?? "");
    const callText = String((callResult.content?.[0] as { text?: unknown })?.text ?? "");

    expect(listText).toContain("ok=true");
    expect(listText).toContain("\"linear\"");
    expect(callText).toContain("target=linear.list_issues");
    expect(callText).toContain("\"issues\"");
  });

  it("blocks mcp calls when turn budget is exhausted", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-mcp-budget",
      tooling: createTooling({
        mcpList: async () => ({
          ok: true,
          command: "mcporter list --output json",
          schema: false,
          format: "json",
          items: [],
        }),
      }),
      budget: {
        maxToolCalls: 5,
        maxMcpCalls: 1,
      },
    });
    const tool = tools.find((item) => item.name === "mcp_list");
    expect(tool).toBeTruthy();

    const first = await tool!.execute("tc-1", {});
    const second = await tool!.execute("tc-2", {});

    const firstText = String((first.content?.[0] as { text?: unknown })?.text ?? "");
    const secondText = String((second.content?.[0] as { text?: unknown })?.text ?? "");
    expect(firstText).toContain("ok=true");
    expect(secondText).toContain("blocked=true");
    expect(secondText).toContain("mcp_call_budget_exceeded:1/1");
  });
});
