import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersistentScheduler } from "./persistent-scheduler.js";

describe("PersistentScheduler", () => {
  let baseDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "kael-scheduler-test-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it("deve executar job de intervalo e persistir nextRunAt", async () => {
    const executed: string[] = [];
    const scheduler = new PersistentScheduler(
      path.join(baseDir, "scheduler.json"),
      100,
      async ({ job }) => {
        executed.push(job.id);
      },
    );
    await scheduler.init();
    await scheduler.upsertIntervalJob({
      id: "heartbeat.main",
      type: "heartbeat",
      intervalMs: 200,
      enabled: true,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(250);

    expect(executed.length).toBeGreaterThan(0);
    const listed = scheduler.listJobs();
    expect(listed[0]?.lastRunAt).toBeTruthy();
  });

  it("deve pausar e retomar um job", async () => {
    const scheduler = new PersistentScheduler(
      path.join(baseDir, "scheduler.json"),
      100,
      async () => {},
    );
    await scheduler.init();
    await scheduler.upsertIntervalJob({
      id: "job1",
      type: "heartbeat",
      intervalMs: 1000,
      enabled: true,
    });

    const paused = await scheduler.setJobEnabled("job1", false);
    expect(paused?.enabled).toBe(false);

    const resumed = await scheduler.setJobEnabled("job1", true);
    expect(resumed?.enabled).toBe(true);
  });
});
