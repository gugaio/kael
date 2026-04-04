import { describe, expect, it, vi } from "vitest";
import { SimpleCommandEngine } from "./simple-engine.js";
import type { EngineBrowserTooling, EngineSystemTooling, EngineTurnInput, EngineToolingNamespaces } from "./types.js";

function createTooling(
  execImpl?: EngineSystemTooling["execCommand"],
  browserImpl?: EngineBrowserTooling["browserCommand"],
): EngineToolingNamespaces {
  return {
    video: {
      startTranscode: async () => ({ id: "j1" } as never),
      startConvertHls: async () => ({ id: "j2" } as never),
      startCaptureStream: async () => ({ id: "j3" } as never),
      startProbeMedia: async () => ({ id: "j4" } as never),
      startPlayVlc: async () => ({ id: "j5" } as never),
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
        input: "https://example.com/video.m3u8",
        timeoutMs: 1000,
        streams: [],
        errors: [],
      }),
      videoGenerateImage: undefined,
      playbackAnalyze: undefined,
    },
    jobs: {
      listJobs: () => [],
      getJob: () => null,
      getJobLog: async ({ jobId }) => ({ jobId, found: false }),
    },
    system: {
      execCommand:
        execImpl ??
        (async () => ({
          id: "s1",
          command: "true",
          cwd: ".",
          status: "completed",
          startedAt: new Date().toISOString(),
          outputTail: "",
        })),
      processCommand: async () => ({ ok: true, action: "list", sessions: [] }),
    },
    mcp: {
      mcpList: async () => ({ ok: true, command: "mcporter list", schema: false, format: "json", items: [] }),
      mcpCall: async () => ({
        ok: true,
        command: "mcporter call linear.list_issues",
        target: "linear.list_issues",
        format: "json",
        output: {},
      }),
    },
    edge: {
      edgeList: () => [],
      edgeCall: async ({ capability }) => ({ ok: false, taskId: "t1", capability, error: "unused" }),
      youboraMetricsGet: async () => ({
        ok: true,
        taskId: "yb1",
        capability: "youbora.metrics.get",
        output: { rows: [] },
      }),
      youboraRawdataGet: async () => ({
        ok: true,
        taskId: "yb2",
        capability: "youbora.rawdata.get",
        output: { rows: [] },
      }),
      youboraEventsGet: async () => ({
        ok: true,
        taskId: "yb3",
        capability: "youbora.events.get",
        output: { rows: [] },
      }),
    },
    memory: {
      memorySearch: async () => [],
      memoryGet: async () => ({ path: "MEMORY.md", text: "", startLine: 1, endLine: 1 }),
      memoryWrite: async () => ({ path: "memory/2026-01-01.md" }),
    },
    knowledge: {
      knowledgeSearch: async () => [],
      knowledgeGet: async () => null,
      knowledgeUpsert: async () => ({
        id: "note-1",
        project: "proj",
        topic: "topic",
        title: "title",
        answer: "answer",
        tags: [],
        files: [],
        evidence: [],
        status: "draft" as const,
        confidence: 0.7,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    },
    workspace: {
      workspaceSearch: async () => [],
      workspaceRead: async () => ({ path: "README.md", text: "", startLine: 1, endLine: 1 }),
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
    },
    browser: {
      browserCommand:
        browserImpl ??
        (async ({ action }) => ({
          ok: false,
          action,
          status: "failed",
          message: "stub",
        })),
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
      imageGenerate: undefined,
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
    },
  };
}

function makeInput(message: string, tooling: EngineToolingNamespaces): EngineTurnInput {
  return {
    sessionKey: "main",
    message,
    tooling,
    contextMessages: [],
  };
}

describe("SimpleCommandEngine", () => {
  it("inicia job de VLC via slash command", async () => {
    const startPlayVlc = vi.fn(async () => ({ id: "j-vlc" } as never));
    const engine = new SimpleCommandEngine();

    const result = await engine.runTurn(
      makeInput(
        "/vlc https://example.com/video.m3u8",
        {
          ...createTooling(),
          video: {
            ...createTooling().video,
            startPlayVlc,
          },
        },
      ),
    );

    expect(startPlayVlc).toHaveBeenCalledTimes(1);
    expect(result.reply).toContain("VLC iniciado. jobId=j-vlc");
  });

  it("executa /browser-start via fast-path", async () => {
    const browserCommand = vi.fn(async () => ({
      ok: true,
      action: "start" as const,
      status: "started" as const,
      message: "browser iniciado",
      targetId: "browser-1",
    }));
    const engine = new SimpleCommandEngine();

    const result = await engine.runTurn(makeInput("/browser-start", createTooling(undefined, browserCommand)));

    expect(browserCommand).toHaveBeenCalledTimes(1);
    expect(browserCommand).toHaveBeenCalledWith({
      sessionKey: "main",
      action: "start",
    });
    expect(result.reply).toContain("browser action=start status=started");
    expect(result.reply).toContain("targetId=browser-1");
  });

  it("executa /browser-open com URL", async () => {
    const browserCommand = vi.fn(async () => ({
      ok: true,
      action: "open" as const,
      status: "navigated" as const,
      message: "navegacao concluida",
      url: "https://example.com/",
      title: "Example Domain",
    }));
    const engine = new SimpleCommandEngine();

    const result = await engine.runTurn(
      makeInput("/browser-open https://example.com", createTooling(undefined, browserCommand)),
    );

    expect(browserCommand).toHaveBeenCalledWith({
      sessionKey: "main",
      action: "open",
      url: "https://example.com",
    });
    expect(result.reply).toContain("status=navigated");
    expect(result.reply).toContain("url=https://example.com/");
  });

  it("valida uso de /browser-type quando faltam argumentos", async () => {
    const engine = new SimpleCommandEngine();
    const result = await engine.runTurn(makeInput("/browser-type #email", createTooling()));
    expect(result.reply).toBe("Uso: /browser-type <selector> <texto>");
  });

  it("executa /browser-type com texto composto", async () => {
    const browserCommand = vi.fn(async () => ({
      ok: true,
      action: "type" as const,
      status: "navigated" as const,
      message: "type executado",
    }));
    const engine = new SimpleCommandEngine();

    await engine.runTurn(
      makeInput("/browser-type #search best local pizza", createTooling(undefined, browserCommand)),
    );

    expect(browserCommand).toHaveBeenCalledWith({
      sessionKey: "main",
      action: "type",
      selector: "#search",
      text: "best local pizza",
    });
  });

  it("executa /youbora metrics com wrapper dedicado", async () => {
    const youboraMetricsGet = vi.fn(async () => ({
      ok: true,
      taskId: "yb-metrics-1",
      capability: "youbora.metrics.get",
      output: { rows: [{ metric: "views", value: 10 }] },
    }));
    const engine = new SimpleCommandEngine();

    const result = await engine.runTurn(
      makeInput(
        "/youbora metrics last24hours views,plays vod hour",
        {
          ...createTooling(),
          edge: {
            ...createTooling().edge,
            youboraMetricsGet,
          },
        },
      ),
    );

    expect(youboraMetricsGet).toHaveBeenCalledWith({
      fromDate: "last24hours",
      toDate: undefined,
      metrics: "views,plays",
      type: "vod",
      granularity: "hour",
    });
    expect(result.reply).toContain("capability=youbora.metrics.get");
  });

  it("executa /youbora rawdata com wrapper dedicado", async () => {
    const youboraRawdataGet = vi.fn(async () => ({
      ok: true,
      taskId: "yb-raw-1",
      capability: "youbora.rawdata.get",
      output: { rows: [] },
    }));
    const engine = new SimpleCommandEngine();

    const result = await engine.runTurn(
      makeInput(
        '/youbora rawdata 2026-03-01 2026-03-02 vod {"account":"globo"}',
        {
          ...createTooling(),
          edge: {
            ...createTooling().edge,
            youboraRawdataGet,
          },
        },
      ),
    );

    expect(youboraRawdataGet).toHaveBeenCalledWith({
      fromDate: "2026-03-01",
      toDate: "2026-03-02",
      type: "vod",
      filters: { account: "globo" },
    });
    expect(result.reply).toContain("capability=youbora.rawdata.get");
  });

  it("executa /youbora events com wrapper dedicado", async () => {
    const youboraEventsGet = vi.fn(async () => ({
      ok: true,
      taskId: "yb-events-1",
      capability: "youbora.events.get",
      output: { rows: [] },
    }));
    const engine = new SimpleCommandEngine();

    const result = await engine.runTurn(
      makeInput(
        '/youbora events last24hours live {"event":"rebuffer"}',
        {
          ...createTooling(),
          edge: {
            ...createTooling().edge,
            youboraEventsGet,
          },
        },
      ),
    );

    expect(youboraEventsGet).toHaveBeenCalledWith({
      fromDate: "last24hours",
      toDate: undefined,
      type: "live",
      filters: { event: "rebuffer" },
    });
    expect(result.reply).toContain("capability=youbora.events.get");
  });
});
