import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import { JobStore } from "../../jobs/store.js";
import type { ProcessRunner } from "../system/process-runner.js";
import { VideoJobService } from "./video-job-service.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
}

class FakeRunner implements ProcessRunner {
  readonly processes: ControlledProcess[] = [];

  spawn(): { process: ChildProcessWithoutNullStreams } {
    const process = new ControlledProcess();
    this.processes.push(process);
    return { process: process as unknown as ChildProcessWithoutNullStreams };
  }
}

describe("VideoJobService runtime controls", () => {
  it("queues jobs when concurrency limit is reached", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-video-"));
    const input = path.join(root, "input.mp4");
    await fs.writeFile(input, "x", "utf-8");

    const store = new JobStore(root);
    await store.init();
    const runner = new FakeRunner();
    const service = new VideoJobService(store, runner, {
      safePathsEnabled: true,
      allowedPaths: [root],
      maxJobArgs: 24,
      maxConcurrentJobs: 1,
      jobTimeoutMs: 60_000,
      killGraceMs: 100,
    });

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

    await sleep(10);
    expect(runner.processes.length).toBe(1);
    expect(store.get(first.id)?.status).toBe("running");
    expect(store.get(second.id)?.status).toBe("queued");

    runner.processes[0]?.emitClose(0);
    await sleep(20);

    expect(runner.processes.length).toBe(2);
    expect(store.get(first.id)?.status).toBe("succeeded");
    expect(store.get(second.id)?.status).toBe("running");

    runner.processes[1]?.emitClose(0);
    await sleep(10);
    expect(store.get(second.id)?.status).toBe("succeeded");
  });

  it("fails job on timeout and sends termination signal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-video-"));
    const input = path.join(root, "input.mp4");
    await fs.writeFile(input, "x", "utf-8");

    const store = new JobStore(root);
    await store.init();
    const runner = new FakeRunner();
    const service = new VideoJobService(store, runner, {
      safePathsEnabled: true,
      allowedPaths: [root],
      maxJobArgs: 24,
      maxConcurrentJobs: 1,
      jobTimeoutMs: 20,
      killGraceMs: 10,
    });

    const job = await service.startProbeMedia({
      sessionKey: "s1",
      inputPath: input,
    });

    await sleep(40);
    const process = runner.processes[0];
    expect(process?.killSignals).toContain("SIGTERM");

    process?.emitClose(null);
    await sleep(10);

    expect(store.get(job.id)?.status).toBe("failed");
    expect(store.get(job.id)?.error).toContain("timed out");
  });
});

