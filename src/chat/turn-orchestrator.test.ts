import { describe, expect, it, vi } from "vitest";
import type { AgentEngine, EngineToolingNamespaces, EngineTurnInput, EngineTurnOutput } from "../engine/types.js";
import type { SessionMessage } from "../types.js";
import { TurnOrchestrator } from "./turn-orchestrator.js";

function createMessage(role: SessionMessage["role"], content: string, idx: number): SessionMessage {
  return {
    id: `m-${idx}`,
    sessionKey: "s1",
    role,
    content,
    createdAt: new Date(1_700_000_000_000 + idx * 1000).toISOString(),
  };
}

function createToolingStub(): EngineToolingNamespaces {
  return {
    video: {
      startTranscode: async () => {
        throw new Error("not used");
      },
      startConvertHls: async () => {
        throw new Error("not used");
      },
      startCaptureStream: async () => {
        throw new Error("not used");
      },
      startProbeMedia: async () => {
        throw new Error("not used");
      },
      startPlayVlc: async () => {
        throw new Error("not used");
      },
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
        input: "x",
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
      execCommand: async () => ({
        id: "1",
        command: "true",
        cwd: ".",
        status: "completed",
        startedAt: new Date().toISOString(),
        outputTail: "",
        endedAt: new Date().toISOString(),
        exitCode: 0,
      }),
      processCommand: async () => ({
        ok: true,
        action: "list",
        sessions: [],
      }),
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
      youboraMetricsGet: async () => ({ ok: true, taskId: "yb1", capability: "youbora.metrics.get", output: {} }),
      youboraRawdataGet: async () => ({ ok: true, taskId: "yb2", capability: "youbora.rawdata.get", output: {} }),
      youboraEventsGet: async () => ({ ok: true, taskId: "yb3", capability: "youbora.events.get", output: {} }),
    },
    memory: {
      memorySearch: async () => [],
      memoryGet: async () => ({
        path: "MEMORY.md",
        text: "",
        startLine: 1,
        endLine: 1,
      }),
      memoryWrite: async () => ({ path: "memory/2000-01-01.md" }),
    },
    knowledge: {
      knowledgeSearch: async () => [],
      knowledgeGet: async () => null,
      knowledgeUpsert: async () => ({
        id: "note-1",
        project: "proj",
        topic: "topic",
        kind: "analysis" as const,
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
      workspaceRead: async () => ({
        path: "README.md",
        text: "",
        startLine: 1,
        endLine: 1,
      }),
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
    },
    image: {
      imageGenerate: undefined,
    },
    plans: {
      planCreate: async () => ({
        id: "p1",
        sessionKey: "s1",
        title: "plan",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [],
      }),
      planGenerate: async () => ({
        id: "p1",
        sessionKey: "s1",
        title: "plan",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [],
      }),
      planList: () => [],
      planGet: () => null,
      planUpdateStep: async () => null,
      planNextAction: () => null,
      planExecuteNext: async () => ({ ok: false, reason: "no_next_step", message: "none" }),
      planReconcile: async () => ({ scannedPlans: 0, updatedPlans: 0, updatedSteps: 0 }),
    },
  };
}

describe("TurnOrchestrator compaction", () => {
  it("compactNow gera compaction quando contexto explode", async () => {
    const messages: SessionMessage[] = [];
    for (let idx = 0; idx < 90; idx += 1) {
      const role = idx % 2 === 0 ? "user" : "assistant";
      messages.push(createMessage(role, `mensagem-${idx} ${"x".repeat(120)}`, idx));
    }

    const appendMessage = vi.fn(async (_sessionKey: string, role: SessionMessage["role"], content: string) => {
      const next = createMessage(role, content, messages.length + 1);
      messages.push(next);
      return next;
    });
    const getMessages = vi.fn(async (_sessionKey: string, limit = 50) =>
      limit > 0 ? messages.slice(-limit) : messages,
    );
    const getCompactionWatermark = vi.fn(async () => ({
      userAssistantCount: messages.filter((item) => item.role === "user" || item.role === "assistant").length,
      lastCompactionUserAssistantCount: null,
      lastCompactionAt: null,
    }));
    const markCompaction = vi.fn(async () => {});

    const sessionStore = {
      appendMessage,
      getMessages,
      getCompactionWatermark,
      markCompaction,
    } as unknown as {
      appendMessage: typeof appendMessage;
      getMessages: typeof getMessages;
      getCompactionWatermark: typeof getCompactionWatermark;
      markCompaction: typeof markCompaction;
    };

    const runTurn = vi.fn(async (input: EngineTurnInput): Promise<EngineTurnOutput> => ({ reply: input.message }));
    const engine: AgentEngine = { runTurn };

    const orchestrator = new TurnOrchestrator(
      sessionStore as never,
      engine,
      { maxContextMessages: 24, maxContextChars: 12000 },
    );

    const result = await orchestrator.compactNow({
      sessionKey: "s1",
      currentMessage: "mensagem atual",
    });

    expect(result.compacted).toBe(true);
    expect(result.reason).toBe("compacted");
    expect(appendMessage).toHaveBeenCalledTimes(1);
    const [sessionArg, roleArg, contentArg] = appendMessage.mock.calls[0];
    expect(sessionArg).toBe("s1");
    expect(roleArg).toBe("system");
    expect(String(contentArg)).toContain("[compaction]");
    expect(markCompaction).toHaveBeenCalledTimes(1);
  });

  it("checkCompactionNeed detecta necessidade sem aplicar", async () => {
    const messages: SessionMessage[] = [];
    for (let idx = 0; idx < 90; idx += 1) {
      const role = idx % 2 === 0 ? "user" : "assistant";
      messages.push(createMessage(role, `mensagem-${idx} ${"x".repeat(120)}`, idx));
    }

    const appendMessage = vi.fn();
    const getMessages = vi.fn(async (_sessionKey: string, limit = 50) =>
      limit > 0 ? messages.slice(-limit) : messages,
    );
    const getCompactionWatermark = vi.fn(async () => ({
      userAssistantCount: messages.filter((item) => item.role === "user" || item.role === "assistant").length,
      lastCompactionUserAssistantCount: null,
      lastCompactionAt: null,
    }));
    const markCompaction = vi.fn(async () => {});

    const engine: AgentEngine = { runTurn: async () => ({ reply: "ok" }) };

    const orchestrator = new TurnOrchestrator(
      { appendMessage, getMessages, getCompactionWatermark, markCompaction } as never,
      engine,
      { maxContextMessages: 24, maxContextChars: 12000 },
    );

    const result = await orchestrator.checkCompactionNeed({
      sessionKey: "s1",
      currentMessage: "mensagem atual",
    });

    expect(result.compacted).toBe(false);
    expect(result.reason).toBe("compaction_needed");
    expect(result.summarizedMessages).toBeGreaterThan(0);
    // Nao deve ter aplicado nada
    expect(appendMessage).not.toHaveBeenCalled();
    expect(markCompaction).not.toHaveBeenCalled();
  });

  it("run nao dispara compaction (responsabilidade do caller)", async () => {
    const messages: SessionMessage[] = [];
    for (let idx = 0; idx < 90; idx += 1) {
      const role = idx % 2 === 0 ? "user" : "assistant";
      messages.push(createMessage(role, `mensagem-${idx} ${"x".repeat(120)}`, idx));
    }

    const appendMessage = vi.fn();
    const getMessages = vi.fn(async (_sessionKey: string, limit = 50) =>
      limit > 0 ? messages.slice(-limit) : messages,
    );
    const getCompactionWatermark = vi.fn(async () => ({
      userAssistantCount: messages.filter((item) => item.role === "user" || item.role === "assistant").length,
      lastCompactionUserAssistantCount: null,
      lastCompactionAt: null,
    }));
    const markCompaction = vi.fn(async () => {});

    const runTurn = vi.fn(async (input: EngineTurnInput): Promise<EngineTurnOutput> => ({ reply: input.message }));
    const engine: AgentEngine = { runTurn };

    const orchestrator = new TurnOrchestrator(
      { appendMessage, getMessages, getCompactionWatermark, markCompaction } as never,
      engine,
      { maxContextMessages: 24, maxContextChars: 12000 },
    );

    await orchestrator.runConversationTurn({
      sessionKey: "s1",
      message: "mensagem atual",
      tooling: createToolingStub(),
    });

    // run() nao deve chamar appendMessage (compaction e feita externamente)
    expect(appendMessage).not.toHaveBeenCalled();
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(markCompaction).not.toHaveBeenCalled();
  });

  it("nao compacta novamente quando ha compaction recente", async () => {
    const messages: SessionMessage[] = [
      ...Array.from({ length: 20 }).map((_, idx) =>
        createMessage(idx % 2 === 0 ? "user" : "assistant", `msg-${idx}`, idx + 1),
      ),
      createMessage("system", "[compaction]\nresumo recente", 99),
    ];
    const appendMessage = vi.fn();
    const getMessages = vi.fn(async (_sessionKey: string, limit = 50) =>
      limit > 0 ? messages.slice(-limit) : messages,
    );
    const getCompactionWatermark = vi.fn(async () => ({
      userAssistantCount: messages.filter((item) => item.role === "user" || item.role === "assistant").length,
      lastCompactionUserAssistantCount: null,
      lastCompactionAt: null,
    }));
    const markCompaction = vi.fn(async () => {});

    const engine: AgentEngine = {
      runTurn: async () => ({ reply: "ok" }),
    };

    const orchestrator = new TurnOrchestrator(
      { appendMessage, getMessages, getCompactionWatermark, markCompaction } as never,
      engine,
      { maxContextMessages: 4, maxContextChars: 200 },
    );

    const result = await orchestrator.checkCompactionNeed({
      sessionKey: "s1",
      currentMessage: "mensagem atual",
    });

    expect(result.compacted).toBe(false);
    expect(result.reason).toBe("recent_compaction");
    expect(appendMessage).not.toHaveBeenCalled();
    expect(markCompaction).not.toHaveBeenCalled();
  });

  it("nao compacta novamente sem progresso suficiente desde a ultima compactacao (watermark)", async () => {
    const messages: SessionMessage[] = Array.from({ length: 80 }).map((_, idx) =>
      createMessage(idx % 2 === 0 ? "user" : "assistant", `msg-${idx} ${"x".repeat(80)}`, idx + 1),
    );
    const appendMessage = vi.fn();
    const getMessages = vi.fn(async (_sessionKey: string, limit = 50) =>
      limit > 0 ? messages.slice(-limit) : messages,
    );
    const getCompactionWatermark = vi.fn(async () => ({
      userAssistantCount: 80,
      lastCompactionUserAssistantCount: 70,
      lastCompactionAt: new Date().toISOString(),
    }));
    const markCompaction = vi.fn(async () => {});

    const engine: AgentEngine = {
      runTurn: async () => ({ reply: "ok" }),
    };

    const orchestrator = new TurnOrchestrator(
      { appendMessage, getMessages, getCompactionWatermark, markCompaction } as never,
      engine,
      { maxContextMessages: 24, maxContextChars: 2000 },
    );

    const result = await orchestrator.checkCompactionNeed({
      sessionKey: "s1",
      currentMessage: "mensagem atual",
    });

    expect(result.compacted).toBe(false);
    expect(result.reason).toBe("recent_compaction");
    expect(appendMessage).not.toHaveBeenCalled();
    expect(markCompaction).not.toHaveBeenCalled();
  });
});
