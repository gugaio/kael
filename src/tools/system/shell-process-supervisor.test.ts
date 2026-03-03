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
});
