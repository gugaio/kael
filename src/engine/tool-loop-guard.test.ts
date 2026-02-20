import { describe, expect, it } from "vitest";
import { ToolLoopGuard } from "./tool-loop-guard.js";

describe("ToolLoopGuard", () => {
  it("bloqueia repeticao rapida de exec com mesmo resultado", () => {
    const guard = new ToolLoopGuard({
      repeatThreshold: 3,
      cooldownMs: 5000,
      repeatWindowMs: 10_000,
    });
    const sessionKey = "s1";
    const params = { command: "ls -la" };
    const result = { status: "completed", exitCode: 0, outputTail: "ok" };

    for (let idx = 0; idx < 3; idx += 1) {
      const before = guard.beforeCall({ sessionKey, tool: "exec", params, nowMs: 1000 + idx * 100 });
      expect(before.allowed).toBe(true);
      guard.afterCall({
        sessionKey,
        tool: "exec",
        params,
        result,
        nowMs: 1000 + idx * 100,
      });
    }

    const blocked = guard.beforeCall({ sessionKey, tool: "exec", params, nowMs: 1400 });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("nao bloqueia quando ha progresso em process poll", () => {
    const guard = new ToolLoopGuard({
      pollNoProgressThreshold: 3,
      repeatThreshold: 10,
      cooldownMs: 5000,
      repeatWindowMs: 10_000,
    });
    const sessionKey = "s1";
    const params = { action: "poll", sessionId: "abc" };

    guard.afterCall({
      sessionKey,
      tool: "process",
      params,
      result: {
        action: "poll",
        ok: true,
        session: { status: "running", outputTail: "step1" },
      },
      nowMs: 1000,
    });
    guard.afterCall({
      sessionKey,
      tool: "process",
      params,
      result: {
        action: "poll",
        ok: true,
        session: { status: "running", outputTail: "step2" },
      },
      nowMs: 2000,
    });
    guard.afterCall({
      sessionKey,
      tool: "process",
      params,
      result: {
        action: "poll",
        ok: true,
        session: { status: "completed", outputTail: "done" },
      },
      nowMs: 3000,
    });

    const decision = guard.beforeCall({ sessionKey, tool: "process", params, nowMs: 3200 });
    expect(decision.allowed).toBe(true);
  });

  it("aplica cooldown apenas para o padrao da sessao/tool", () => {
    const guard = new ToolLoopGuard({
      repeatThreshold: 2,
      cooldownMs: 5000,
      repeatWindowMs: 10_000,
    });

    const params = { command: "pwd" };
    guard.afterCall({
      sessionKey: "s1",
      tool: "exec",
      params,
      result: { status: "completed", outputTail: "/tmp" },
      nowMs: 1000,
    });
    guard.afterCall({
      sessionKey: "s1",
      tool: "exec",
      params,
      result: { status: "completed", outputTail: "/tmp" },
      nowMs: 1200,
    });

    const blocked = guard.beforeCall({ sessionKey: "s1", tool: "exec", params, nowMs: 1400 });
    expect(blocked.allowed).toBe(false);

    const otherSession = guard.beforeCall({ sessionKey: "s2", tool: "exec", params, nowMs: 1400 });
    expect(otherSession.allowed).toBe(true);

    const otherTool = guard.beforeCall({
      sessionKey: "s1",
      tool: "process",
      params: { action: "list" },
      nowMs: 1400,
    });
    expect(otherTool.allowed).toBe(true);
  });
});

