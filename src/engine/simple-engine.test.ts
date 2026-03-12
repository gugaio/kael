import { describe, expect, it, vi } from "vitest";
import { SimpleCommandEngine } from "./simple-engine.js";
import type { EngineTurnInput, EngineTooling } from "./types.js";

function createTooling(
  execImpl?: EngineTooling["execCommand"],
  browserImpl?: EngineTooling["browserCommand"],
): EngineTooling {
  return {
    startTranscode: async () => ({ id: "j1" } as never),
    startConvertHls: async () => ({ id: "j2" } as never),
    startCaptureStream: async () => ({ id: "j3" } as never),
    startProbeMedia: async () => ({ id: "j4" } as never),
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
    listJobs: () => [],
    getJob: () => null,
    getJobLog: async ({ jobId }) => ({ jobId, found: false }),
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
    mcpList: async () => ({ ok: true, command: "mcporter list", schema: false, format: "json", items: [] }),
    mcpCall: async () => ({
      ok: true,
      command: "mcporter call linear.list_issues",
      target: "linear.list_issues",
      format: "json",
      output: {},
    }),
    memorySearch: async () => [],
    memoryGet: async () => ({ path: "MEMORY.md", text: "", startLine: 1, endLine: 1 }),
    memoryWrite: async () => ({ path: "memory/2026-01-01.md" }),
    workspaceSearch: async () => [],
    workspaceRead: async () => ({ path: "README.md", text: "", startLine: 1, endLine: 1 }),
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
    planCreate: async () => ({ id: "p1" } as never),
    planGenerate: async () => ({ id: "p1" } as never),
    planList: () => [],
    planGet: () => null,
    planUpdateStep: async () => null,
    planNextAction: () => null,
    planExecuteNext: async () => ({ ok: false, reason: "no_next_step", message: "none" }),
    planReconcile: async () => ({ scannedPlans: 0, updatedPlans: 0, updatedSteps: 0 }),
  };
}

function makeInput(message: string, tooling: EngineTooling): EngineTurnInput {
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
          startPlayVlc,
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
});
