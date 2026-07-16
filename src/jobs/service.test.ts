import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import { JobStore } from "./store.js";
import { JobService } from "./service.js";
import { LocalProcessSupervisor } from "../process/supervisor.js";
import type { ProcessRunner } from "../process/runner.js";
import { createFfmpegJobs } from "../ffmpeg/jobs.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error(`condition was not met within ${String(timeoutMs)}ms`);
    }
    await sleep(5);
  }
}

class ControlledProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killSignals: string[] = [];
  killed = false;

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.killSignals.push(typeof signal === "string" ? signal : "SIGTERM");
    return true;
  }

  emitClose(code: number | null): void {
    this.emit("close", code);
  }

  emitError(error: Error): void {
    this.emit("error", error);
  }
}

class FakeRunner implements ProcessRunner {
  readonly processes: ControlledProcess[] = [];

  spawn(): { process: ChildProcessWithoutNullStreams } {
    const process = new ControlledProcess();
    this.processes.push(process);
    return { process: process as unknown as ChildProcessWithoutNullStreams };
  }
}

function createTestJobs(store: JobStore, runner: ProcessRunner, jobTimeoutMs = 60_000, killGraceMs = 10) {
  const supervisor = new LocalProcessSupervisor(runner);
  const jobs = new JobService(store, supervisor, {
    maxConcurrentJobs: 1,
    jobTimeoutMs,
    killGraceMs,
  });
  return {
    jobs,
    ffmpeg: createFfmpegJobs({
      jobs,
      options: { safePathsEnabled: false, allowedPaths: [], maxJobArgs: 24 },
    }),
  };
}

describe("JobService runtime controls", () => {
  it("queues jobs when concurrency limit is reached", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-video-"));
    const input = path.join(root, "input.mp4");
    await fs.writeFile(input, "x", "utf-8");

    const store = new JobStore(root);
    await store.init();
    const runner = new FakeRunner();
    const { ffmpeg: service } = createTestJobs(store, runner, 60_000, 100);

    const first = await service.startTranscode({
      sessionKey: "s1",
      inputPath: input,
      outputPath: path.join(root, "out-1.mp4"),
    });
    const second = await service.startTranscode({
      sessionKey: "s1",
      inputPath: input,
      outputPath: path.join(root, "out-2.mp4"),
    });

    await waitFor(() => runner.processes.length === 1);
    expect(store.get(first.id)?.status).toBe("running");
    expect(store.get(second.id)?.status).toBe("queued");

    runner.processes[0]?.emitClose(0);
    await waitFor(() => runner.processes.length === 2 && store.get(first.id)?.status === "succeeded");
    expect(runner.processes.length).toBe(2);
    expect(store.get(first.id)?.status).toBe("succeeded");
    expect(store.get(second.id)?.status).toBe("running");

    runner.processes[1]?.emitClose(0);
    await waitFor(() => store.get(second.id)?.status === "succeeded");
    expect(store.get(second.id)?.status).toBe("succeeded");
  });

  it("fails job on timeout and sends termination signal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-video-"));
    const input = path.join(root, "input.mp4");
    await fs.writeFile(input, "x", "utf-8");

    const store = new JobStore(root);
    await store.init();
    const runner = new FakeRunner();
    const { ffmpeg: service } = createTestJobs(store, runner, 20);

    const job = await service.startTranscode({
      sessionKey: "s1",
      inputPath: input,
      outputPath: path.join(root, "out.mp4"),
    });

    await sleep(40);
    const process = runner.processes[0];
    expect(process?.killSignals).toContain("SIGTERM");

    process?.emitClose(null);
    await waitFor(() => store.get(job.id)?.status === "failed");

    expect(store.get(job.id)?.status).toBe("failed");
    expect(store.get(job.id)?.error).toContain("timed out");
  });

  it("cancels queued and running jobs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-video-"));
    const input = path.join(root, "input.mp4");
    await fs.writeFile(input, "x", "utf-8");

    const store = new JobStore(root);
    await store.init();
    const runner = new FakeRunner();
    const { jobs, ffmpeg: service } = createTestJobs(store, runner);

    const running = await service.startTranscode({
      sessionKey: "s1",
      inputPath: input,
      outputPath: path.join(root, "running.mp4"),
    });
    const queued = await service.startTranscode({
      sessionKey: "s1",
      inputPath: input,
      outputPath: path.join(root, "queued.mp4"),
    });
    await waitFor(() => runner.processes.length === 1 && store.get(running.id)?.status === "running");

    const queuedCancel = await jobs.cancelJob(queued.id);
    expect(queuedCancel.canceled).toBe(true);
    expect(store.get(queued.id)?.status).toBe("canceled");

    const runningCancel = await jobs.cancelJob(running.id);
    expect(runningCancel.canceled).toBe(true);
    expect(runner.processes[0]?.killSignals).toContain("SIGTERM");

    runner.processes[0]?.emitClose(null);
    await waitFor(() => store.get(running.id)?.status === "canceled");
    expect(store.get(running.id)?.status).toBe("canceled");
  });

  it("keeps canceled status when process emits error after cancel", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-video-"));
    const input = path.join(root, "input.mp4");
    await fs.writeFile(input, "x", "utf-8");

    const store = new JobStore(root);
    await store.init();
    const runner = new FakeRunner();
    const { jobs, ffmpeg: service } = createTestJobs(store, runner);

    const running = await service.startTranscode({
      sessionKey: "s1",
      inputPath: input,
      outputPath: path.join(root, "running.mp4"),
    });
    const queued = await service.startTranscode({
      sessionKey: "s1",
      inputPath: input,
      outputPath: path.join(root, "queued.mp4"),
    });
    await sleep(10);

    await jobs.cancelJob(running.id);
    runner.processes[0]?.emitError(new Error("kill failed"));
    await waitFor(() => runner.processes.length === 2 && store.get(queued.id)?.status === "running");

    expect(store.get(running.id)?.status).toBe("canceled");

    // Error handler deve liberar slot e drenar fila.
    expect(runner.processes.length).toBe(2);
    expect(store.get(queued.id)?.status).toBe("running");
  });
});
