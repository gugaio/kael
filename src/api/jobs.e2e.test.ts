import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { KaelApp } from "../app.js";
import { createApiServer } from "./server.js";
import { JobManager } from "../jobs/manager.js";
import { JobStore } from "../jobs/store.js";
import { VideoJobService } from "../tools/video/video-job-service.js";
import type { ProcessRunner } from "../tools/system/process-runner.js";

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

  spawn(): { process: ChildProcessByStdio<Writable, Readable, Readable> } {
    const process = new ControlledProcess();
    this.processes.push(process);
    return { process: process as unknown as ChildProcessByStdio<Writable, Readable, Readable> };
  }
}

async function createJobsServer(params: {
  root: string;
  runner: FakeRunner;
  maxConcurrentJobs?: number;
  jobTimeoutMs?: number;
}): Promise<{ server: ReturnType<typeof createApiServer>; jobs: JobManager }> {
  const store = new JobStore(params.root);
  await store.init();

  const video = new VideoJobService(store, params.runner, {
    safePathsEnabled: true,
    allowedPaths: [params.root],
    maxJobArgs: 24,
    maxConcurrentJobs: params.maxConcurrentJobs ?? 1,
    jobTimeoutMs: params.jobTimeoutMs ?? 60_000,
    killGraceMs: 10,
  });
  const jobs = new JobManager(store, video);

  const app: KaelApp = {
    config: {
      host: "127.0.0.1",
      port: 3210,
      dataDir: params.root,
      engineMode: "simple",
      context: { maxMessages: 24, maxChars: 12_000 },
      idempotency: { enabled: true, ttlMs: 60_000 },
      automation: {
        heartbeatEnabled: true,
        heartbeatIntervalMs: 30_000,
        plannerReconcileEnabled: true,
        plannerReconcileIntervalMs: 5_000,
        schedulerTickMs: 1_000,
      },
      execution: {
        safePathsEnabled: true,
        allowedPaths: [params.root],
        maxJobArgs: 24,
        maxConcurrentJobs: params.maxConcurrentJobs ?? 1,
        jobTimeoutMs: params.jobTimeoutMs ?? 60_000,
        killGraceMs: 10,
      },
      shell: {
        workspaceRoot: params.root,
        defaultTimeoutMs: 60_000,
        noOutputTimeoutMs: 30_000,
        maxTimeoutMs: 900_000,
        maxOutputChars: 120_000,
        approvalWaitMs: 120_000,
        security: "allowlist",
        ask: "on-miss",
        allowlist: ["ls", "cat"],
      },
      research: {
        enabled: false,
        provider: "tavily",
        defaultMaxResults: 5,
        maxResultsLimit: 10,
        timeoutMs: 12_000,
        fetchMaxChars: 12_000,
        fetchCacheTtlMs: 600_000,
        fetchMaxRedirects: 3,
        fetchMaxResponseBytes: 2_000_000,
      },
      email: {
        enabled: false,
        pollIntervalMs: 60_000,
        provider: "gmail_pop3",
        autoReplyEnabled: false,
        gmail: {
          address: "",
          appPassword: "",
          host: "pop.gmail.com",
          port: 995,
          timeoutMs: 15_000,
          topLines: 40,
          maxMessagesPerPoll: 10,
          smtpHost: "smtp.gmail.com",
          smtpPort: 465,
          smtpTimeoutMs: 15_000,
        },
      },
      pi: {
        enabled: true,
        provider: "openai",
        systemPrompt: "test",
        model: "gpt-4o-mini",
        timeoutMs: 45_000,
        retry: { attempts: 2, baseDelayMs: 10, maxDelayMs: 50, jitterMs: 10 },
      },
    },
    sessions: {
      countSessions: async () => 0,
    } as unknown as KaelApp["sessions"],
    jobs,
    planner: {
      list: () => [],
      get: () => null,
      create: async ({
        sessionKey,
        title,
        steps,
      }: {
        sessionKey: string;
        title: string;
        steps: string[];
      }) => ({
        id: "plan-1",
        sessionKey,
        title,
        status: steps.length > 0 ? "active" : "completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [],
      }),
      generate: async ({
        sessionKey,
        objective,
      }: {
        sessionKey: string;
        objective: string;
      }) => ({
        id: "plan-generated",
        sessionKey,
        title: `Plano: ${objective}`,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [],
      }),
      updateStep: async () => null,
      appendStep: async () => null,
      nextAction: () => null,
      executeNext: async () => ({
        ok: false,
        reason: "no_next_step",
        message: "no step",
      }),
      reconcile: async () => ({
        scannedPlans: 0,
        updatedPlans: 0,
        updatedSteps: 0,
      }),
      cancelPlan: async ({
        planId,
      }: {
        planId: string;
      }) => ({
        id: planId,
        sessionKey: "s1",
        title: "Plano",
        status: "canceled",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [],
      }),
    } as unknown as KaelApp["planner"],
    research: {} as KaelApp["research"],
    memory: {} as KaelApp["memory"],
    chat: {
      handleMessage: async () => ({
        reply: "ok",
        user: {
          id: "u1",
          sessionKey: "main",
          role: "user",
          content: "msg",
          createdAt: new Date().toISOString(),
        },
        assistant: {
          id: "a1",
          sessionKey: "main",
          role: "assistant",
          content: "ok",
          createdAt: new Date().toISOString(),
        },
      }),
      getHistory: async () => [],
    } as unknown as KaelApp["chat"],
    automation: {
      listSchedules: () => [],
      getSchedule: () => null,
      upsertIntervalSchedule: async () => {
        throw new Error("not implemented");
      },
      upsertCronSchedule: async () => {
        throw new Error("not implemented");
      },
      setScheduleEnabled: async () => null,
    } as unknown as KaelApp["automation"],
    shell: {
      listApprovals: async () => [],
      resolveApproval: async () => null,
    } as unknown as KaelApp["shell"],
  };

  return { server: createApiServer(app), jobs };
}

async function getJobStatus(server: ReturnType<typeof createApiServer>, jobId: string): Promise<string> {
  const response = await server.inject({
    method: "GET",
    url: `/jobs/${jobId}`,
  });
  const body = response.json();
  return body.job.status as string;
}

describe("Jobs E2E API", () => {
  it("creates VLC job via /jobs/vlc", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-jobs-e2e-"));
    const runner = new FakeRunner();
    const { server } = await createJobsServer({ root, runner });

    const created = await server.inject({
      method: "POST",
      url: "/jobs/vlc",
      payload: {
        sessionKey: "s1",
        input: "https://example.com/live.m3u8",
      },
    });

    expect(created.statusCode).toBe(200);
    const body = created.json();
    expect(body.ok).toBe(true);
    expect(body.job.type).toBe("play_vlc");
    expect(body.job.command).toBe("vlc");
    await server.close();
  });

  it("rejects unsafe input path outside allowed roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-jobs-e2e-"));
    const runner = new FakeRunner();
    const { server } = await createJobsServer({ root, runner });

    const response = await server.inject({
      method: "POST",
      url: "/jobs/probe",
      payload: {
        sessionKey: "s1",
        inputPath: "/etc/passwd",
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(String(body.error.message)).toContain("path outside allowed roots");
    await server.close();
  });

  it("marks job as failed on timeout and writes timeout line to log", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-jobs-e2e-"));
    const input = path.join(root, "input.mp4");
    await fs.writeFile(input, "x", "utf-8");

    const runner = new FakeRunner();
    const { server } = await createJobsServer({ root, runner, jobTimeoutMs: 20 });

    const created = await server.inject({
      method: "POST",
      url: "/jobs/probe",
      payload: {
        sessionKey: "s1",
        inputPath: input,
      },
    });
    expect(created.statusCode).toBe(200);
    const createdBody = created.json();
    const jobId = createdBody.job.id as string;

    await sleep(40);
    expect(runner.processes[0]?.killSignals).toContain("SIGTERM");
    runner.processes[0]?.emitClose(null);
    await sleep(20);

    expect(await getJobStatus(server, jobId)).toBe("failed");
    const logResponse = await server.inject({ method: "GET", url: `/jobs/${jobId}/log` });
    expect(logResponse.statusCode).toBe(200);
    expect(String(logResponse.json().log)).toContain("[timeout]");
    await server.close();
  });

  it("cancels queued and running jobs via API", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-jobs-e2e-"));
    const input = path.join(root, "input.mp4");
    await fs.writeFile(input, "x", "utf-8");

    const runner = new FakeRunner();
    const { server } = await createJobsServer({ root, runner, maxConcurrentJobs: 1 });

    const first = await server.inject({
      method: "POST",
      url: "/jobs/probe",
      payload: { sessionKey: "s1", inputPath: input },
    });
    const firstJobId = first.json().job.id as string;

    const second = await server.inject({
      method: "POST",
      url: "/jobs/probe",
      payload: { sessionKey: "s1", inputPath: input },
    });
    const secondJobId = second.json().job.id as string;

    await sleep(10);
    const cancelQueued = await server.inject({
      method: "POST",
      url: `/jobs/${secondJobId}/cancel`,
    });
    expect(cancelQueued.statusCode).toBe(200);
    expect(cancelQueued.json().canceled).toBe(true);
    expect(await getJobStatus(server, secondJobId)).toBe("canceled");

    const cancelRunning = await server.inject({
      method: "POST",
      url: `/jobs/${firstJobId}/cancel`,
    });
    expect(cancelRunning.statusCode).toBe(200);
    expect(cancelRunning.json().canceled).toBe(true);
    expect(runner.processes[0]?.killSignals).toContain("SIGTERM");

    runner.processes[0]?.emitClose(null);
    await sleep(20);
    expect(await getJobStatus(server, firstJobId)).toBe("canceled");
    expect(runner.processes.length).toBe(1);
    await server.close();
  });
});
