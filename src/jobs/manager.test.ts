import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JobManager } from "./manager.js";
import { JobStore } from "./store.js";
import type { JobCapability } from "./capabilities.js";
import type { VideoJob } from "../types.js";
import { VIDEO_JOB_ACTIONS } from "../capabilities/video/index.js";

describe("JobManager capabilities", () => {
  it("routes start action to registered capability", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-job-manager-"));
    const store = new JobStore(root);
    await store.init();
    const expected: VideoJob = {
      id: "job-1",
      capability: "video",
      action: "transcode",
      sessionKey: "s1",
      command: "ffmpeg",
      input: "/tmp/in.mp4",
      output: "/tmp/out.mp4",
      args: [],
      status: "queued",
      createdAt: new Date().toISOString(),
      logPath: "/tmp/log.txt",
    };
    const startTranscode = vi.fn(async () => expected);
    const videoCapability: JobCapability = {
      name: "video",
      actions: {
        transcode: startTranscode,
      },
      cancelJob: async () => ({ job: null, canceled: false }),
      getRuntimeStats: () => ({ activeJobs: 1, queuedJobs: 2, maxConcurrentJobs: 3 }),
    };

    const manager = new JobManager(store, [videoCapability]);
    const result = await manager.startAction(VIDEO_JOB_ACTIONS.transcode, {
      sessionKey: "s1",
      inputPath: "/tmp/in.mp4",
      outputPath: "/tmp/out.mp4",
    });

    expect(startTranscode).toHaveBeenCalledOnce();
    expect(result.id).toBe("job-1");
  });

  it("aggregates runtime stats from all capabilities", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-job-manager-"));
    const store = new JobStore(root);
    await store.init();
    const a: JobCapability = {
      name: "a",
      actions: {},
      cancelJob: async () => ({ job: null, canceled: false }),
      getRuntimeStats: () => ({ activeJobs: 1, queuedJobs: 2, maxConcurrentJobs: 3 }),
    };
    const b: JobCapability = {
      name: "b",
      actions: {},
      cancelJob: async () => ({ job: null, canceled: false }),
      getRuntimeStats: () => ({ activeJobs: 4, queuedJobs: 5, maxConcurrentJobs: 6 }),
    };

    const manager = new JobManager(store, [a, b]);

    expect(manager.getRuntimeStats()).toEqual({
      activeJobs: 5,
      queuedJobs: 7,
      maxConcurrentJobs: 9,
    });
  });

  it("routes cancel based on stored job type", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-job-manager-"));
    const store = new JobStore(root);
    await store.init();
    const createdAt = new Date().toISOString();
    await store.create({
      id: "job-cancel",
      capability: "video",
      action: "transcode",
      sessionKey: "s1",
      command: "ffmpeg",
      input: "/tmp/in.mp4",
      output: "/tmp/out.mp4",
      args: [],
      status: "queued",
      createdAt,
      logPath: store.getLogPath("job-cancel"),
    });
    const cancel = vi.fn(async () => ({ job: store.get("job-cancel"), canceled: true }));
    const videoCapability: JobCapability = {
      name: "video",
      actions: {
        transcode: async () => {
          throw new Error("not used");
        },
      },
      cancelJob: cancel,
    };

    const manager = new JobManager(store, [videoCapability]);
    const result = await manager.cancelJob("job-cancel");

    expect(cancel).toHaveBeenCalledWith("job-cancel");
    expect(result.canceled).toBe(true);
  });
});
