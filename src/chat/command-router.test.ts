import { describe, expect, it, vi } from "vitest";
import { CommandRouter } from "./command-router.js";
import type { AgentEngine, EngineTooling } from "../engine/types.js";

function createTooling(): EngineTooling {
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
    execCommand: async () => ({
      id: "s1",
      command: "true",
      cwd: ".",
      status: "completed",
      startedAt: new Date().toISOString(),
      outputTail: "",
    }),
    processCommand: async () => ({ ok: true, action: "list", sessions: [] }),
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
    browserCommand: async ({ action }) => ({
      ok: false,
      action,
      status: "failed",
      message: "stub",
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

describe("CommandRouter", () => {
  it("nao roteia quando atalhos operacionais estao desativados", async () => {
    const runTurn = vi.fn(async () => ({ reply: "ok" }));
    const engine: AgentEngine = { runTurn };
    const router = new CommandRouter(engine);

    const result = await router.tryRoute({
      sessionKey: "main",
      message: "/jobs",
      tooling: createTooling(),
      allowOperationalShortcuts: false,
    });

    expect(result).toEqual({ handled: false });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("nao roteia mensagens sem slash", async () => {
    const runTurn = vi.fn(async () => ({ reply: "ok" }));
    const engine: AgentEngine = { runTurn };
    const router = new CommandRouter(engine);

    const result = await router.tryRoute({
      sessionKey: "main",
      message: "listar jobs",
      tooling: createTooling(),
      allowOperationalShortcuts: true,
    });

    expect(result).toEqual({ handled: false });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("roteia slash command para engine dedicado", async () => {
    const runTurn = vi.fn(async () => ({ reply: "Ultimos jobs:\n- j1" }));
    const engine: AgentEngine = { runTurn };
    const router = new CommandRouter(engine);

    const result = await router.tryRoute({
      sessionKey: "main",
      message: "/jobs",
      requestId: "req-1",
      tooling: createTooling(),
      allowOperationalShortcuts: true,
    });

    expect(result).toEqual({ handled: true, reply: "Ultimos jobs:\n- j1" });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "main",
        message: "/jobs",
        requestId: "req-1",
      }),
    );
  });
});
