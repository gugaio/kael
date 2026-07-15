import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ShellProcessSupervisor } from "./shell-process-supervisor.js";
import type { LocalProcessRunner } from "./process-runner.js";

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  signalCode: NodeJS.Signals | null = null;
  private readonly onKill?: (signal?: NodeJS.Signals) => void;

  constructor(onKill?: (signal?: NodeJS.Signals) => void) {
    super();
    this.onKill = onKill;
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.signalCode = signal ?? "SIGTERM";
    this.onKill?.(signal);
    return true;
  }
}

class FakeRunner {
  private factories: Array<() => FakeChildProcess> = [];

  enqueue(factory: () => FakeChildProcess): void {
    this.factories.push(factory);
  }

  spawn(): { process: FakeChildProcess } {
    const factory = this.factories.shift();
    if (!factory) {
      throw new Error("fake spawn without prepared factory");
    }
    return { process: factory() };
  }
}

function createSupervisor(runner: FakeRunner): ShellProcessSupervisor {
  return new ShellProcessSupervisor(runner as unknown as LocalProcessRunner, {
    maxOutputChars: 20_000,
    noOutputTimeoutMs: 10_000,
    killGraceMs: 100,
  });
}

describe("ShellProcessSupervisor", () => {
  it("prioritizes timed_out when kill races with timeout and close arrives late", async () => {
    const runner = new FakeRunner();
    const holder: { child: FakeChildProcess | null } = { child: null };
    runner.enqueue(() => {
      holder.child = new FakeChildProcess();
      return holder.child;
    });
    const supervisor = createSupervisor(runner);

    const started = supervisor.startProcess({
      sessionKey: "s1",
      command: "fake",
      cwd: ".",
      timeoutMs: 40,
      resolveShell: () => ({ command: "sh", args: ["-c"] }),
      looksLikeCommandNotFound: () => false,
    });
    const completion = supervisor.getCompletion(started.id);
    if (!completion) {
      throw new Error("missing completion promise");
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
    await supervisor.processCommand({
      sessionKey: "s1",
      action: "kill",
      sessionId: started.id,
    });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 40);
    });
    if (!holder.child) {
      throw new Error("missing child ref");
    }
    holder.child.emit("close", null);

    const final = await completion;
    expect(final.status).toBe("timed_out");
    expect(final.failureCode).toBe("timeout_overall");
  });

  it("supports remove during output without restoring removed session", async () => {
    const runner = new FakeRunner();
    const holder: { child: FakeChildProcess | null } = { child: null };
    runner.enqueue(() => {
      holder.child = new FakeChildProcess();
      return holder.child;
    });
    const supervisor = createSupervisor(runner);

    const started = supervisor.startProcess({
      sessionKey: "s1",
      command: "fake-stream",
      cwd: ".",
      timeoutMs: 10_000,
      resolveShell: () => ({ command: "sh", args: ["-c"] }),
      looksLikeCommandNotFound: () => false,
    });

    if (!holder.child) {
      throw new Error("missing child ref");
    }
    holder.child.stdout.write("chunk-1\n");
    const removed = await supervisor.processCommand({
      sessionKey: "s1",
      action: "remove",
      sessionId: started.id,
    });
    expect(removed.ok).toBe(true);

    holder.child.stdout.write("chunk-2\n");
    holder.child.emit("close", 0);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 15);
    });

    const pollAfter = await supervisor.processCommand({
      sessionKey: "s1",
      action: "poll",
      sessionId: started.id,
    });
    expect(pollAfter.ok).toBe(false);
  });

  it("write: escreve no stdin de processo ativo", async () => {
    const runner = new FakeRunner();
    const written: string[] = [];
    let stdinEnded = false;

    runner.enqueue(() => {
      const child = new FakeChildProcess();
      // Substitui stdin por um stream que captura o que foi escrito
      const PassThrough = require("node:stream").PassThrough;
      const fakeStdin = new PassThrough();
      fakeStdin.on("data", (chunk: Buffer) => written.push(chunk.toString()));
      fakeStdin.on("end", () => { stdinEnded = true; });
      (child as unknown as Record<string, unknown>).stdin = fakeStdin;
      return child;
    });

    const supervisor = createSupervisor(runner);
    const started = supervisor.startProcess({
      sessionKey: "s1",
      command: "fake",
      cwd: ".",
      timeoutMs: 5_000,
      resolveShell: () => ({ command: "sh", args: ["-c"] }),
      looksLikeCommandNotFound: () => false,
    });

    const writeResult = await supervisor.processCommand({
      sessionKey: "s1",
      action: "write",
      sessionId: started.id,
      data: "hello\n",
      eof: true,
    });
    expect(writeResult.ok).toBe(true);
    expect(written.join("")).toContain("hello");
    expect(stdinEnded).toBe(true);
  });

  it("write: retorna erro quando sessao nao esta em execucao", async () => {
    const runner = new FakeRunner();
    const supervisor = createSupervisor(runner);

    const result = await supervisor.processCommand({
      sessionKey: "s1",
      action: "write",
      sessionId: "nonexistent-id",
    });
    expect(result.ok).toBe(false);
  });

  it("3E: exit 126 mapeia para command_not_executable", async () => {
    const runner = new FakeRunner();
    const holder: { child: FakeChildProcess | null } = { child: null };
    runner.enqueue(() => {
      holder.child = new FakeChildProcess();
      return holder.child;
    });
    const supervisor = createSupervisor(runner);
    const started = supervisor.startProcess({
      sessionKey: "s1",
      command: "fake",
      cwd: ".",
      timeoutMs: 5_000,
      resolveShell: () => ({ command: "sh", args: ["-c"] }),
      looksLikeCommandNotFound: () => false,
    });
    const completion = supervisor.getCompletion(started.id);
    holder.child!.emit("close", 126);
    const final = await completion;
    expect(final.status).toBe("failed");
    expect(final.failureCode).toBe("command_not_executable");
    expect(final.exitCode).toBe(126);
  });

  it("3E: exit 127 mapeia para command_not_found sem heuristica de texto", async () => {
    const runner = new FakeRunner();
    const holder: { child: FakeChildProcess | null } = { child: null };
    runner.enqueue(() => {
      holder.child = new FakeChildProcess();
      return holder.child;
    });
    const supervisor = createSupervisor(runner);
    const started = supervisor.startProcess({
      sessionKey: "s1",
      command: "fake",
      cwd: ".",
      timeoutMs: 5_000,
      resolveShell: () => ({ command: "sh", args: ["-c"] }),
      looksLikeCommandNotFound: () => false, // heuristica retorna false, mas exit code prevalece
    });
    const completion = supervisor.getCompletion(started.id);
    holder.child!.emit("close", 127);
    const final = await completion;
    expect(final.status).toBe("failed");
    expect(final.failureCode).toBe("command_not_found");
  });

  it("3G: cancelBySessionKey mata processos da sessao alvo", async () => {
    const runner = new FakeRunner();
    const killed: string[] = [];
    runner.enqueue(() => new FakeChildProcess((sig) => killed.push(`s1:${sig ?? "SIGTERM"}`)));
    runner.enqueue(() => new FakeChildProcess((sig) => killed.push(`s2:${sig ?? "SIGTERM"}`)));
    runner.enqueue(() => new FakeChildProcess((sig) => killed.push(`other:${sig ?? "SIGTERM"}`)));

    const supervisor = createSupervisor(runner);
    const start = (key: string, cmd: string) =>
      supervisor.startProcess({
        sessionKey: key,
        command: cmd,
        cwd: ".",
        timeoutMs: 10_000,
        resolveShell: () => ({ command: "sh", args: ["-c"] }),
        looksLikeCommandNotFound: () => false,
      });

    start("session-a", "cmd1");
    start("session-a", "cmd2");
    start("session-b", "cmd3");

    supervisor.cancelBySessionKey("session-a");

    // session-a teve dois processos mortos; session-b nao foi afetado
    expect(killed.filter((k) => k.startsWith("s")).length).toBe(2);
    expect(killed.filter((k) => k.startsWith("other")).length).toBe(0);
  });
});
