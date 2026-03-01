import { describe, expect, it, vi } from "vitest";
import { SimpleCommandEngine } from "./simple-engine.js";
import type { EngineTurnInput, EngineTooling } from "./types.js";

function createTooling(execImpl?: EngineTooling["execCommand"]): EngineTooling {
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
    planCreate: async () => ({ id: "p1" } as never),
    planGenerate: async () => ({ id: "p1" } as never),
    planList: () => [],
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
});
