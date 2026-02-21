import { describe, expect, it, vi } from "vitest";
import type { AgentEngine, EngineTooling, EngineTurnInput, EngineTurnOutput } from "../engine/types.js";
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

function createToolingStub(): EngineTooling {
  return {
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
    listJobs: () => [],
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
    memorySearch: async () => [],
    memoryGet: async () => ({
      path: "MEMORY.md",
      text: "",
      startLine: 1,
      endLine: 1,
    }),
    memoryWrite: async () => ({ path: "memory/2000-01-01.md" }),
    workspaceSearch: async () => [],
    workspaceRead: async () => ({
      path: "README.md",
      text: "",
      startLine: 1,
      endLine: 1,
    }),
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
    planUpdateStep: async () => null,
    planNextAction: () => null,
    planExecuteNext: async () => ({ ok: false, reason: "no_next_step", message: "none" }),
    planReconcile: async () => ({ scannedPlans: 0, updatedPlans: 0, updatedSteps: 0 }),
  };
}

describe("TurnOrchestrator compaction", () => {
  it("gera compaction automatica quando contexto explode", async () => {
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

    const sessionStore = {
      appendMessage,
      getMessages,
    } as unknown as {
      appendMessage: typeof appendMessage;
      getMessages: typeof getMessages;
    };

    const runTurn = vi.fn(async (input: EngineTurnInput): Promise<EngineTurnOutput> => ({ reply: input.message }));
    const engine: AgentEngine = { runTurn };

    const orchestrator = new TurnOrchestrator(
      sessionStore as never,
      engine,
      { maxContextMessages: 24, maxContextChars: 12000 },
    );

    await orchestrator.run({
      sessionKey: "s1",
      message: "mensagem atual",
      tooling: createToolingStub(),
    });

    expect(appendMessage).toHaveBeenCalledTimes(1);
    const [sessionArg, roleArg, contentArg] = appendMessage.mock.calls[0];
    expect(sessionArg).toBe("s1");
    expect(roleArg).toBe("system");
    expect(String(contentArg)).toContain("[compaction]");
    const calledInput = runTurn.mock.calls[0]?.[0];
    if (!calledInput) {
      throw new Error("engine.runTurn should be called");
    }
    const contextMessages = calledInput.contextMessages ?? [];
    expect(contextMessages.some((item) => item.role === "system")).toBe(true);
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

    const engine: AgentEngine = {
      runTurn: async () => ({ reply: "ok" }),
    };

    const orchestrator = new TurnOrchestrator(
      { appendMessage, getMessages } as never,
      engine,
      { maxContextMessages: 4, maxContextChars: 200 },
    );
    await orchestrator.run({
      sessionKey: "s1",
      message: "mensagem atual",
      tooling: createToolingStub(),
    });

    expect(appendMessage).not.toHaveBeenCalled();
  });
});
