import { describe, expect, it, vi } from "vitest";
import { createPiShellTools } from "./pi-tools.js";
import type {
  EngineBrowserTooling,
  EngineEdgeTooling,
  EngineImageTooling,
  EngineJobsTooling,
  EngineMcpTooling,
  EngineMemoryTooling,
  EnginePlansTooling,
  EngineSystemTooling,
  EngineToolingNamespaces,
  EngineVideoTooling,
  EngineWebTooling,
  EngineWorkspaceTooling,
} from "./types.js";

type ToolingOverrides = {
  video?: Partial<EngineVideoTooling>;
  jobs?: Partial<EngineJobsTooling>;
  system?: Partial<EngineSystemTooling>;
  mcp?: Partial<EngineMcpTooling>;
  edge?: Partial<EngineEdgeTooling>;
  memory?: Partial<EngineMemoryTooling>;
  workspace?: Partial<EngineWorkspaceTooling>;
  web?: Partial<EngineWebTooling>;
  browser?: Partial<EngineBrowserTooling>;
  image?: Partial<EngineImageTooling>;
  plans?: Partial<EnginePlansTooling>;
};

function createTooling(overrides: ToolingOverrides = {}): EngineToolingNamespaces {
  return {
    video: {
      startTranscode: async () => ({ id: "job-1" } as never),
      startConvertHls: async () => ({ id: "job-2" } as never),
      startCaptureStream: async () => ({ id: "job-3" } as never),
      startProbeMedia: async () => ({ id: "job-4" } as never),
      startPlayVlc: async () => ({ id: "job-5" } as never),
      videoHlsInspect: async () => ({
        ok: true,
        url: "https://example.com/master.m3u8",
        finalUrl: "https://example.com/master.m3u8",
        playlistType: "master" as const,
        variants: [],
        renditions: [],
        segments: [],
        errors: [],
      }),
      videoProbe: async () => ({
        ok: true,
        input: "input.mp4",
        timeoutMs: 1000,
        streams: [],
        errors: [],
      }),
      videoManifestDiff: undefined,
      videoGenerateImage: undefined,
      playbackAnalyze: undefined,
      ...overrides.video,
    },
    jobs: {
      listJobs: () => [],
      getJob: () => null,
      getJobLog: async ({ jobId }) => ({ jobId, found: false }),
      ...overrides.jobs,
    },
    system: {
      execCommand: async () => ({
          id: "exec-1",
          command: "true",
          cwd: ".",
          status: "completed",
          startedAt: new Date().toISOString(),
          outputTail: "",
        }),
      processCommand: async () => ({ ok: true, action: "list", sessions: [] }),
      ...overrides.system,
    },
    mcp: {
      mcpList: async () => ({ ok: true, command: "mcporter list", schema: false, format: "json", items: [] }),
      mcpCall: async () => ({
          ok: true,
          command: "mcporter call stub",
          target: "stub.call",
          format: "json",
          output: {},
        }),
      ...overrides.mcp,
    },
    edge: {
      edgeList: () => [],
      edgeCall: async ({ capability }) => ({ ok: true, taskId: "edge-1", capability, output: {} }),
      youboraMetricsGet: async () => ({ ok: true, taskId: "yb-1", capability: "youbora.metrics.get", output: {} }),
      youboraRawdataGet: async () => ({ ok: true, taskId: "yb-2", capability: "youbora.rawdata.get", output: {} }),
      youboraEventsGet: async () => ({ ok: true, taskId: "yb-3", capability: "youbora.events.get", output: {} }),
      ...overrides.edge,
    },
    memory: {
      memorySearch: async () => [],
      memoryGet: async () => ({ path: "MEMORY.md", text: "", startLine: 1, endLine: 1 }),
      memoryWrite: async () => ({ path: "memory/2026-01-01.md" }),
      ...overrides.memory,
    },
    workspace: {
      workspaceSearch: async () => [],
      workspaceRead: async () => ({ path: "README.md", text: "", startLine: 1, endLine: 1 }),
      ...overrides.workspace,
    },
    web: {
      webSearch: async () => ({ answer: "ok", sources: [], notes: [] }),
      webFetch: async () => ({
          url: "https://example.com",
          finalUrl: "https://example.com",
          content: "ok",
          excerpt: "ok",
          fetchedAt: new Date().toISOString(),
          cached: false,
        }),
      webResearch: async () => ({
          query: "q",
          summary: "s",
          confidence: 0.7,
          confidenceReason: "r",
          evidence: [],
          notes: [],
        }),
      ...overrides.web,
    },
    browser: {
      browserCommand: async ({ action }) => ({
          ok: true,
          action,
          status: "started",
          message: "ok",
        }),
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
      ...overrides.browser,
    },
    image: {
      imageGenerate: undefined,
      ...overrides.image,
    },
    plans: {
      planCreate: async () => ({ id: "p1" } as never),
      planGenerate: async () => ({ id: "p1" } as never),
      planList: () => [],
      planGet: () => null,
      planUpdateStep: async () => null,
      planNextAction: () => null,
      planExecuteNext: async () => ({ ok: false, reason: "no_next_step", message: "none" }),
      planReconcile: async () => ({ scannedPlans: 0, updatedPlans: 0, updatedSteps: 0 }),
      ...overrides.plans,
    },
  };
}

describe("createPiShellTools image_generate", () => {
  it("returns failed result instead of throwing when generation errors", async () => {
    const tools = createPiShellTools({
      sessionKey: "s1",
      tooling: createTooling({
        image: {
          imageGenerate: async () => {
            throw new Error("image backend timeout");
          },
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
        image: {
          imageGenerate,
        },
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
        video: {
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
        },
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


describe("createPiShellTools video_manifest_diff", () => {
  it("exposes video_manifest_diff and reports added issues", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-diff",
      tooling: createTooling({
        video: {
          videoManifestDiff: async ({ leftUrl, rightUrl }) => ({
            ok: false,
            summary: "1 issue nova no manifesto da direita",
            playlistTypeChanged: false,
            left: {
              ok: true,
              url: leftUrl,
              finalUrl: leftUrl,
              playlistType: "master",
              summary: "left",
              stats: { variants: 2, renditions: 1, segments: 0, variantsAudited: 0, variantsWithErrors: 0 },
              issues: [],
              variantAudits: [],
              aggregateIssues: [],
              recommendations: [],
            },
            right: {
              ok: false,
              url: rightUrl,
              finalUrl: rightUrl,
              playlistType: "master",
              summary: "right",
              stats: { variants: 2, renditions: 1, segments: 0, variantsAudited: 0, variantsWithErrors: 1 },
              issues: [{ code: "variant_fetch_failures", severity: "error", summary: "Falha nova", evidence: [] }],
              variantAudits: [],
              aggregateIssues: [],
              recommendations: [],
            },
            delta: {
              variants: 0,
              renditions: 0,
              segments: 0,
              variantsAudited: 0,
              variantsWithErrors: 1,
            },
            issueDiff: {
              added: [{ code: "variant_fetch_failures", severity: "error", summary: "Falha nova", evidence: [] }],
              removed: [],
              persisted: [],
            },
            aggregateIssueDiff: { added: [], removed: [], persisted: [] },
            variantDiff: {
              added: [],
              removed: [],
              changed: [],
              regressed: [
                {
                  matchKey: "v1.m3u8",
                  status: "regressed",
                  regressionSeverity: "high",
                  regressionScore: 85,
                  delta: {},
                  issueDiff: { added: [], removed: [], persisted: [] },
                  changedFields: ["targetDuration", "audioGroupId"],
                  summary: "Variant v1.m3u8 regrediu",
                },
              ],
              improved: [],
              unchanged: [],
            },
            recommendations: ["Priorizar as novas issues"],
          }),
        },
      }),
    });
    const tool = tools.find((item) => item.name === "video_manifest_diff");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-diff", {
      leftUrl: "https://a.example/master.m3u8",
      rightUrl: "https://b.example/master.m3u8",
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");

    expect(text).toContain("ok=false");
    expect(text).toContain("issues.added=1");
    expect(text).toContain("variants.regressed=1");
    expect(text).toContain("variant_fetch_failures");
  });
});

describe("createPiShellTools browser budget", () => {
  it("bloqueia segunda chamada de browser quando maxBrowserCalls=1", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-browser",
      tooling: createTooling({
        browser: {
          browserCommand: async ({ action }) => ({
            ok: true,
            action,
            status: "started",
            message: "ok",
          }),
        },
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
        jobs: {
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
        },
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
        plans: {
          planGet: () => null,
        },
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
        edge: {
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
        },
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
        edge: {
          edgeCall: async () => ({
            ok: true,
            taskId: "task-1",
            capability: "system.info",
            output: {},
          }),
        },
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

  it("exposes youbora_metrics_get as typed wrapper over edge_call", async () => {
    const youboraMetricsGet = vi.fn(async () => ({
      ok: true,
      taskId: "task-yb-1",
      clientId: "clark-1",
      connectionId: "conn-1",
      capability: "youbora.metrics.get",
      durationMs: 18,
      output: { rows: [{ metric: "views", value: 123 }] },
    }));
    const tools = createPiShellTools({
      sessionKey: "s-youbora",
      tooling: createTooling({
        edge: {
          youboraMetricsGet,
        },
      }),
    });
    const tool = tools.find((item) => item.name === "youbora_metrics_get");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-yb", {
      fromDate: "last24hours",
      metrics: "views,plays",
      type: "vod",
      clientId: "clark-1",
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");

    expect(youboraMetricsGet).toHaveBeenCalledWith({
      fromDate: "last24hours",
      toDate: undefined,
      metrics: "views,plays",
      type: "vod",
      granularity: undefined,
      filters: undefined,
      clientId: "clark-1",
      timeoutMs: undefined,
    });
    expect(text).toContain("ok=true");
    expect(text).toContain("capability=youbora.metrics.get");
    expect(text).toContain("fromDate=last24hours");
    expect(text).toContain("metrics=views,plays");
  });

  it("exposes youbora_rawdata_get as typed wrapper over tooling method", async () => {
    const youboraRawdataGet = vi.fn(async () => ({
      ok: true,
      taskId: "task-yb-raw-1",
      clientId: "clark-1",
      connectionId: "conn-1",
      capability: "youbora.rawdata.get",
      durationMs: 9,
      output: { rows: [] },
    }));
    const tools = createPiShellTools({
      sessionKey: "s-youbora-raw",
      tooling: createTooling({
        edge: {
          youboraRawdataGet,
        },
      }),
    });
    const tool = tools.find((item) => item.name === "youbora_rawdata_get");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-yb-raw", {
      fromDate: "last24hours",
      type: "vod",
      filtersJson: "{\"country\":\"br\"}",
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");

    expect(youboraRawdataGet).toHaveBeenCalledWith({
      fromDate: "last24hours",
      toDate: undefined,
      type: "vod",
      filters: { country: "br" },
      clientId: undefined,
      timeoutMs: undefined,
    });
    expect(text).toContain("capability=youbora.rawdata.get");
  });

  it("exposes youbora_events_get as typed wrapper over tooling method", async () => {
    const youboraEventsGet = vi.fn(async () => ({
      ok: true,
      taskId: "task-yb-events-1",
      clientId: "clark-1",
      connectionId: "conn-1",
      capability: "youbora.events.get",
      durationMs: 9,
      output: { rows: [] },
    }));
    const tools = createPiShellTools({
      sessionKey: "s-youbora-events",
      tooling: createTooling({
        edge: {
          youboraEventsGet,
        },
      }),
    });
    const tool = tools.find((item) => item.name === "youbora_events_get");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-yb-events", {
      fromDate: "last24hours",
      type: "live",
      filtersJson: "{\"event\":\"rebuffer\"}",
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");

    expect(youboraEventsGet).toHaveBeenCalledWith({
      fromDate: "last24hours",
      toDate: undefined,
      type: "live",
      filters: { event: "rebuffer" },
      clientId: undefined,
      timeoutMs: undefined,
    });
    expect(text).toContain("capability=youbora.events.get");
  });
});

describe("createPiShellTools mcp tools", () => {
  it("exposes mcp_list and mcp_call using tooling state methods", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-mcp",
      tooling: createTooling({
        mcp: {
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
        },
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
        mcp: {
          mcpList: async () => ({
            ok: true,
            command: "mcporter list --output json",
            schema: false,
            format: "json",
            items: [],
          }),
        },
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
