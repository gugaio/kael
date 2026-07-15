import { once } from "node:events";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { KaelApp } from "../app.js";
import type { SchedulerJob } from "../automation/scheduler/persistent-scheduler.js";
import { EdgeRuntime } from "../edge/runtime.js";
import { createApiServer } from "./server.js";

function withAgentContext(legacy: Record<string, unknown>): KaelApp {
  return {
    config: legacy.config as KaelApp["config"],
    agent: {
      core: {
        sessions: legacy.sessions as KaelApp["agent"]["core"]["sessions"],
        orchestrator: {} as KaelApp["agent"]["core"]["orchestrator"],
      },
      runtimes: {
        shell: legacy.shell as KaelApp["agent"]["runtimes"]["shell"],
        mcp: legacy.mcp as KaelApp["agent"]["runtimes"]["mcp"],
        edge: legacy.edge as KaelApp["agent"]["runtimes"]["edge"],
        browser: {} as KaelApp["agent"]["runtimes"]["browser"],
      },
      services: {
        memory: legacy.memory as KaelApp["agent"]["services"]["memory"],
        workspace: {} as KaelApp["agent"]["services"]["workspace"],
        research: legacy.research as KaelApp["agent"]["services"]["research"],
        planner: legacy.planner as KaelApp["agent"]["services"]["planner"],
        skills: {} as KaelApp["agent"]["services"]["skills"],
        media: {} as KaelApp["agent"]["services"]["media"],
      },
      video: {
        jobs: legacy.jobs as KaelApp["agent"]["video"]["jobs"],
        ffmpeg: legacy.ffmpeg as KaelApp["agent"]["video"]["ffmpeg"],
        inspect: {} as KaelApp["agent"]["video"]["inspect"],
        playbackTriage: {} as KaelApp["agent"]["video"]["playbackTriage"],
        streamMonitor: legacy.streamMonitor as KaelApp["agent"]["video"]["streamMonitor"],
        streamer: legacy.streamer as KaelApp["agent"]["video"]["streamer"],
        serveManager: legacy.serveManager as KaelApp["agent"]["video"]["serveManager"],
      },
      generation: {
        image: {} as KaelApp["agent"]["generation"]["image"],
        video: {} as KaelApp["agent"]["generation"]["video"],
      },
    },
    chat: legacy.chat as KaelApp["chat"],
    automation: legacy.automation as KaelApp["automation"],
    ...(legacy.emailIngest ? { emailIngest: legacy.emailIngest as KaelApp["emailIngest"] } : {}),
  };
}

function makeFakeApp(): KaelApp {
  const schedules = new Map<string, SchedulerJob>();
  let chatCallCount = 0;
  let lastChatInput:
    | {
        sessionKey: string;
        message: string;
        attachments?: Array<{ kind: "image" | "audio"; dataBase64: string; mimeType?: string; fileName?: string }>;
      }
    | null = null;

  schedules.set("heartbeat.main", {
    id: "heartbeat.main",
    type: "heartbeat",
    enabled: true,
    schedule: { kind: "interval", intervalMs: 30_000 },
    nextRunAt: new Date(Date.now() + 30_000).toISOString(),
  });

  const legacy = {
    config: {
      host: "127.0.0.1",
      port: 3210,
      dataDir: ".kael-data",
      api: {},
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
        allowedPaths: ["/tmp"],
        maxJobArgs: 24,
        maxConcurrentJobs: 2,
        jobTimeoutMs: 60000,
        killGraceMs: 3000,
      },
      shell: {
        workspaceRoot: "/tmp",
        defaultTimeoutMs: 60_000,
        noOutputTimeoutMs: 30_000,
        maxTimeoutMs: 900_000,
        maxOutputChars: 120_000,
        approvalWaitMs: 120_000,
        security: "allowlist",
        ask: "on-miss",
        allowlist: ["ls", "cat"],
      },
      mcp: {
        enabled: false,
        binary: "mcporter",
        defaultTimeoutMs: 30_000,
        maxOutputChars: 120_000,
        allowHttp: false,
        allowStdio: false,
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
      media: {
        enabled: false,
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        timeoutMs: 20_000,
        imageGenerationTimeoutMs: 20_000,
        maxAttachmentBytes: 8_000_000,
        maxTotalBytesPerMessage: 12_000_000,
        maxProcessingMsPerMessage: 15_000,
        maxAttachmentsPerMessage: 3,
        maxAttachmentsBySource: {
          api: 3,
          discord: 2,
          email: 1,
          unknown: 2,
        },
        imageModel: "gpt-4o-mini",
        imagePrompt: "test",
        audioModel: "gpt-4o-mini-transcribe",
      },
      browser: {
        enabled: false,
        headless: true,
        defaultTimeoutMs: 30_000,
        actionTimeoutMs: 12_000,
        maxScreenshotsPerTurn: 3,
        sessionTtlMs: 20 * 60 * 1000,
        maxSessions: 4,
        artifactDir: ".kael-data/browser/artifacts",
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
      countSessions: async () => 2,
    } as unknown as KaelApp["agent"]["core"]["sessions"],
    jobs: {
      listJobs: () => [],
      getStatusCounts: () => ({
        queued: 1,
        running: 2,
        succeeded: 3,
        failed: 4,
        canceled: 0,
      }),
      getRuntimeStats: () => ({
        activeJobs: 1,
        queuedJobs: 2,
        maxConcurrentJobs: 2,
      }),
      getJob: () => null,
      getJobLog: async () => null,
      startTranscode: async () => ({ id: "j1" }),
      startConvertHls: async () => ({ id: "j2" }),
      startCaptureStream: async () => ({ id: "j3" }),
      cancelJob: async (jobId: string) => ({
        job: { id: jobId, status: "canceled" },
        canceled: true,
      }),
    } as unknown as KaelApp["agent"]["video"]["jobs"],
    ffmpeg: {} as KaelApp["agent"]["video"]["ffmpeg"],
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
        steps: steps.map((step: string, idx: number) => ({
          id: `st-${idx}`,
          title: step,
          status: "pending",
          updatedAt: new Date().toISOString(),
        })),
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
        steps: [
          {
            id: "st-1",
            title: "Confirmar objetivo e entradas/saidas esperadas",
            status: "pending",
            updatedAt: new Date().toISOString(),
            checkpoints: [{ at: new Date().toISOString(), status: "pending" }],
          },
        ],
      }),
      updateStep: async () => null,
      appendStep: async () => null,
      nextAction: () => null,
      executeNext: async ({ planId }: { planId: string }) => ({
        ok: true,
        plan: {
          id: planId,
          sessionKey: "s1",
          title: "Plano fake",
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          steps: [
            {
              id: "st-1",
              title: "Executar transcode",
              status: "in_progress",
              updatedAt: new Date().toISOString(),
              checkpoints: [{ at: new Date().toISOString(), status: "in_progress" }],
              execution: {
                kind: "job",
                refId: "job-xyz",
                status: "queued",
                startedAt: new Date().toISOString(),
              },
            },
          ],
        },
        stepIndex: 0,
        action: "transcode",
        execution: {
          kind: "job",
          refId: "job-xyz",
          status: "queued",
          startedAt: new Date().toISOString(),
        },
      }),
      reconcile: async () => ({
        scannedPlans: 2,
        updatedPlans: 1,
        updatedSteps: 1,
      }),
      cancelPlan: async ({ planId }: { planId: string }) => ({
        id: planId,
        sessionKey: "s1",
        title: "Plano fake",
        status: "canceled",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [
          {
            id: "st-1",
            title: "step",
            status: "canceled",
            updatedAt: new Date().toISOString(),
            checkpoints: [{ at: new Date().toISOString(), status: "canceled" }],
          },
        ],
      }),
    } as unknown as KaelApp["agent"]["services"]["planner"],
    research: {} as KaelApp["agent"]["services"]["research"],
    memory: {} as KaelApp["agent"]["services"]["memory"],
    chat: {
      handleMessage: async ({
        sessionKey,
        message,
        attachments,
      }: {
        sessionKey: string;
        message: string;
        attachments?: Array<{
          kind: "image" | "audio";
          dataBase64: string;
          mimeType?: string;
          fileName?: string;
        }>;
      }) => {
        chatCallCount += 1;
        lastChatInput = {
          sessionKey,
          message,
          attachments,
        };
        return {
          reply: `echo:${message}`,
          user: {
            id: `u-${chatCallCount}`,
            sessionKey: "main",
            role: "user",
            content: message,
            createdAt: new Date().toISOString(),
          },
          assistant: {
            id: `a-${chatCallCount}`,
            sessionKey: "main",
            role: "assistant",
            content: `echo:${message}`,
            createdAt: new Date().toISOString(),
          },
        };
      },
      getHistory: async () => [],
      getRoutingTelemetrySnapshot: () => ({
        total: chatCallCount,
        compact: 1,
        fastPath: 2,
        llmTurn: Math.max(0, chatCallCount - 3),
        lastRouteKind: chatCallCount > 0 ? ("llm_turn" as const) : null,
        lastRouteAt: chatCallCount > 0 ? new Date().toISOString() : null,
      }),
      getEngineRuntimeTelemetrySnapshot: () => ({
        timeouts: 2,
        toolCallsByName: {
          web_search: 7,
          web_fetch: 4,
        },
        blockedCallsByTool: {
          web_search: 1,
        },
      }),
      getMediaRuntimeTelemetrySnapshot: () => ({
        processedRequests: chatCallCount,
        appliedRequests: 1,
        imageDescribed: 2,
        audioTranscribed: 1,
        failures: 0,
        processedAttachments: 3,
        skippedTooLarge: 0,
        skippedBySourceLimit: 0,
        skippedByTotalBytesBudget: 0,
        skippedByProcessingBudget: 0,
      }),
      getBrowserRuntimeTelemetrySnapshot: () => ({
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
      getSkillsRuntimeTelemetrySnapshot: () => ({
        enabled: true,
        skillsDir: "/tmp/.kael/skills",
        skillsDiscovered: 2,
        manualInvocations: 1,
        autoInvocations: 0,
        invocationBlocked: 0,
        autoDecisionCounts: {
          selected: 0,
          slash_message: 0,
          no_discovered_skills: 0,
          no_auto_invocable_skills: 0,
          generic_message: 0,
          below_threshold: 1,
          auto_disabled: 0,
        },
        lastAutoDecision: {
          at: new Date().toISOString(),
          reason: "below_threshold",
          skillName: null,
        },
        sessionAuto: {
          trackedSessions: 1,
          sessionsWithSelection: 0,
        },
        lastError: null,
      }),
      // only for test assertions in this fake
      __getLastInput: () => lastChatInput,
    } as unknown as KaelApp["chat"],
    automation: {
      listSchedules: () => Array.from(schedules.values()),
      getSchedule: (id: string) => schedules.get(id) ?? null,
      upsertIntervalSchedule: async ({
        id,
        type,
        intervalMs,
        enabled,
      }: {
        id: string;
        type: string;
        intervalMs: number;
        enabled: boolean;
      }) => {
        const schedule: SchedulerJob = {
          id,
          type,
          enabled,
          schedule: { kind: "interval", intervalMs },
          nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
        };
        schedules.set(id, schedule);
        return schedule;
      },
      upsertCronSchedule: async ({
        id,
        type,
        cronExpr,
        enabled,
      }: {
        id: string;
        type: string;
        cronExpr: string;
        enabled: boolean;
      }) => {
        const schedule: SchedulerJob = {
          id,
          type,
          enabled,
          schedule: { kind: "cron", cronExpr },
          nextRunAt: new Date(Date.now() + 60_000).toISOString(),
        };
        schedules.set(id, schedule);
        return schedule;
      },
      setScheduleEnabled: async (id: string, enabled: boolean) => {
        const current = schedules.get(id);
        if (!current) {
          return null;
        }
        const next = { ...current, enabled };
        schedules.set(id, next);
        return next;
      },
    } as unknown as KaelApp["automation"],
    shell: {
      listApprovals: async () => [],
      resolveApproval: async () => null,
    } as unknown as KaelApp["agent"]["runtimes"]["shell"],
    mcp: {
      init: async () => {},
      list: async () => ({ ok: true, command: "mcporter list", schema: false, format: "json", items: [] }),
      call: async () => ({
        ok: true,
        command: "mcporter call linear.list_issues",
        target: "linear.list_issues",
        format: "json",
        output: {},
      }),
      listServers: async () => [
        {
          name: "local-http",
          transport: "http",
          target: "https://example.com/mcp",
          enabled: true,
          requireApproval: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      getServer: async (name: string) =>
        name === "local-http"
          ? {
              name: "local-http",
              transport: "http",
              target: "https://example.com/mcp",
              enabled: true,
              requireApproval: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : null,
      upsertServer: async (entry: {
        name: string;
        transport: "config" | "http" | "stdio";
        target: string;
        enabled?: boolean;
        requireApproval?: boolean;
        description?: string;
      }) => ({
        name: entry.name,
        transport: entry.transport,
        target: entry.target,
        enabled: entry.enabled ?? true,
        requireApproval: entry.requireApproval ?? true,
        description: entry.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      listApprovals: async () => [
        {
          id: "mcp-ap-1",
          serverName: "local-http",
          transport: "http",
          target: "https://example.com/mcp",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          status: "pending",
        },
      ],
      resolveApproval: async (approvalId: string, decision: "approved" | "denied") => ({
        id: approvalId,
        serverName: "local-http",
        transport: "http",
        target: "https://example.com/mcp",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        status: decision,
        decidedAt: new Date().toISOString(),
      }),
      getRuntimeTelemetrySnapshot: () => ({
        enabled: false,
        configuredServers: 1,
        enabledServers: 1,
        totalCalls: 3,
        listCalls: 1,
        callCalls: 2,
        blockedCalls: 1,
        failedCalls: 1,
        approvalPending: 1,
        approvalsOpen: 1,
        serversByTransport: {
          config: 0,
          http: 1,
          stdio: 0,
        },
        lastError: "mcp_approval_required:mcp-ap-1",
        lastCallAt: new Date().toISOString(),
      }),
    } as unknown as KaelApp["agent"]["runtimes"]["mcp"],
    emailIngest: {
      getRuntimeTelemetrySnapshot: () => ({
        polls: 4,
        messagesSeen: 6,
        processed: 3,
        duplicateSkipped: 2,
        inFlightSkipped: 1,
        selfSkipped: 0,
        lastPollAt: new Date().toISOString(),
      }),
    },
    edge: new EdgeRuntime(),
    streamMonitor: {
      startWatch: () => "watch-stub",
      stopWatch: () => true,
      getStatus: () => null,
      listWatches: () => [],
      stopAll: () => {},
    },
    streamer: {
      listOrigins: async () => [],
      inspectOrigin: async () => {
        throw new Error("streamer inspect not implemented in fake app");
      },
      probeOrigin: async () => {
        throw new Error("streamer probe not implemented in fake app");
      },
      analyzeOrigin: async () => {
        throw new Error("streamer analyze not implemented in fake app");
      },
      mutateOrigin: async () => {
        throw new Error("streamer mutate not implemented in fake app");
      },
      removeOrigin: async () => {
        throw new Error("streamer remove not implemented in fake app");
      },
      cloneHls: async () => {
        throw new Error("streamer clone not implemented in fake app");
      },
      cloneDash: async () => {
        throw new Error("streamer DASH clone not implemented in fake app");
      },
      serveOrigin: async () => {
        throw new Error("streamer serve not implemented in fake app");
      },
      serveLiveOrigin: async () => {
        throw new Error("streamer live not implemented in fake app");
      },
    },
    serveManager: {
      serve: async () => { throw new Error("serve not implemented"); },
      serveLive: async () => { throw new Error("serve live not implemented"); },
      stop: async () => false,
      listServing: () => [],
      isServing: () => false,
      stopAll: async () => {},
    } as unknown as KaelApp["agent"]["video"]["serveManager"],
  };
  return withAgentContext(legacy);
}

describe("API integration", () => {
  it("requires a Bearer token when API authentication is configured", async () => {
    const app = makeFakeApp();
    app.config.api.authToken = "test-api-token";
    const server = createApiServer(app);

    const unauthorized = await server.inject({ method: "GET", url: "/health" });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().error.code).toBe("UNAUTHORIZED");

    const authorized = await server.inject({
      method: "GET",
      url: "/health",
      headers: { authorization: "Bearer test-api-token" },
    });
    expect(authorized.statusCode).toBe(200);
    await server.close();
  });

  it("returns standardized BAD_REQUEST for invalid /chat payload", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "POST",
      url: "/chat",
      payload: { sessionKey: "s1" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.status).toBe(400);
    expect(typeof body.error.message).toBe("string");
    expect(typeof body.error.requestId).toBe("string");
    await server.close();
  });

  it("accepts chat attachments payload and forwards to chat service", async () => {
    const app = makeFakeApp();
    const server = createApiServer(app);
    const response = await server.inject({
      method: "POST",
      url: "/chat",
      payload: {
        sessionKey: "s1",
        message: "analisa isso",
        attachments: [
          {
            kind: "image",
            dataBase64: "aGVsbG8=",
            mimeType: "image/png",
            fileName: "img.png",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toBe("echo:analisa isso");
    const lastInput = (app.chat as unknown as { __getLastInput: () => unknown }).__getLastInput() as {
      attachments?: Array<{ kind: string; mimeType?: string; fileName?: string; dataBase64: string }>;
    } | null;
    expect(lastInput?.attachments?.length).toBe(1);
    expect(lastInput?.attachments?.[0]).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      fileName: "img.png",
      dataBase64: "aGVsbG8=",
    });
    await server.close();
  });

  it("returns enriched /health metrics", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("kael");
    expect(typeof body.version).toBe("string");
    expect(typeof body.uptimeSec).toBe("number");
    expect(body.metrics.sessions).toBe(2);
    expect(body.metrics.totalJobs).toBe(10);
    expect(body.metrics.jobsByStatus.failed).toBe(4);
    expect(body.metrics.runtimeJobs.activeJobs).toBe(1);
    expect(body.metrics.chatRouting.fastPath).toBe(2);
    expect(body.metrics.chatRouting.compact).toBe(1);
    expect(typeof body.metrics.chatRouting.total).toBe("number");
    expect(body.metrics.engineRuntime.timeouts).toBe(2);
    expect(body.metrics.engineRuntime.toolCallsByName.web_search).toBe(7);
    expect(body.metrics.engineRuntime.blockedCallsByTool.web_search).toBe(1);
    expect(body.metrics.browserRuntime.enabled).toBe(false);
    expect(body.metrics.browserRuntime.commands).toBe(0);
    expect(body.metrics.skillsRuntime.enabled).toBe(true);
    expect(body.metrics.skillsRuntime.skillsDiscovered).toBe(2);
    expect(body.metrics.skillsRuntime.autoDecisionCounts.below_threshold).toBe(1);
    expect(body.metrics.skillsRuntime.sessionAuto.trackedSessions).toBe(1);
    expect(body.metrics.mcpRuntime.configuredServers).toBe(1);
    expect(body.metrics.mcpRuntime.approvalsOpen).toBe(1);
    expect(body.metrics.mcpRuntime.serversByTransport.http).toBe(1);
    expect(body.metrics.emailIngest.processed).toBe(3);
    expect(body.metrics.emailIngest.duplicateSkipped).toBe(2);
    expect(body.metrics.emailIngest.inFlightSkipped).toBe(1);
    expect(body.metrics.emailIngest.selfSkipped).toBe(0);
    expect(body.metrics.schedules.total).toBeGreaterThan(0);
    expect(body.metrics.edgeRuntime.connectedClients).toBe(0);
    await server.close();
  });

  it("deletes a cloned stream origin and stops active serving first", async () => {
    const app = makeFakeApp();
    const calls: string[] = [];
    app.agent.video.streamer.listOrigins = async () => [
      {
        id: "origin-a",
        schemaVersion: 2,
        faults: [],
        createdAt: "2026-06-27T00:00:00.000Z",
        sourceUrl: "https://example.com/index.m3u8",
        selectedUrl: "https://example.com/index.m3u8",
        rootDir: "/tmp/origin-a",
        playbackPath: "index.m3u8",
        requestedDurationSeconds: 60,
        cumulativeDurationSeconds: 60,
        reachedTargetDuration: true,
        targetDuration: 6,
        segmentCount: 10,
        variantCount: 1,
        renditionCount: 0,
        bytes: 1024,
        allVariants: false,
      },
    ];
    app.agent.video.serveManager.stop = async (originId: string) => {
      calls.push(`stop:${originId}`);
      return true;
    };
    app.agent.video.streamer.removeOrigin = async (originId: string) => {
      calls.push(`remove:${originId}`);
      return { id: originId, rootDir: "/tmp/origin-a", removed: true };
    };
    const server = createApiServer(app);

    const response = await server.inject({
      method: "DELETE",
      url: "/streams/origin-a",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      removed: { id: "origin-a", rootDir: "/tmp/origin-a", removed: true },
    });
    expect(calls).toEqual(["stop:origin-a", "remove:origin-a"]);
    await server.close();
  });

  it("probes and analyzes cloned streams through API", async () => {
    const app = makeFakeApp();
    app.agent.video.streamer.probeOrigin = async (originId, options) => ({
      originId,
      ok: true,
      sampledMediaPlaylists: options?.maxMediaPlaylists ?? 1,
      totalMediaPlaylists: 1,
      okCount: 1,
      failedCount: 0,
      entries: [],
    });
    app.agent.video.streamer.analyzeOrigin = async (originId, options) => ({
      originId,
      ok: true,
      sampledMediaPlaylists: 1,
      totalMediaPlaylists: 1,
      sampledSegments: options?.full ? 2 : 1,
      okSegments: options?.full ? 2 : 1,
      failedSegments: 0,
      media: [],
      avAlignment: {
        status: "unknown",
        comparedPairs: 0,
        notes: [],
      },
      issues: [],
      entries: [],
    });
    const server = createApiServer(app);

    const probe = await server.inject({
      method: "POST",
      url: "/streams/origin-a/probe",
      payload: { maxMediaPlaylists: 2 },
    });
    expect(probe.statusCode).toBe(200);
    expect(probe.json()).toMatchObject({
      ok: true,
      report: { originId: "origin-a", sampledMediaPlaylists: 2 },
    });

    const analyze = await server.inject({
      method: "POST",
      url: "/streams/origin-a/analyze",
      payload: { full: true },
    });
    expect(analyze.statusCode).toBe(200);
    expect(analyze.json()).toMatchObject({
      ok: true,
      report: { originId: "origin-a", sampledSegments: 2 },
    });
    await server.close();
  });

  it("starts cloned stream serving with requested host", async () => {
    const app = makeFakeApp();
    let requestedHost: string | undefined;
    app.agent.video.streamer.listOrigins = async () => [
      {
        id: "origin-a",
        schemaVersion: 2,
        faults: [],
        createdAt: "2026-06-27T00:00:00.000Z",
        sourceUrl: "https://example.com/index.m3u8",
        selectedUrl: "https://example.com/index.m3u8",
        rootDir: "/tmp/origin-a",
        playbackPath: "index.m3u8",
        requestedDurationSeconds: 60,
        cumulativeDurationSeconds: 60,
        reachedTargetDuration: true,
        targetDuration: 6,
        segmentCount: 10,
        variantCount: 1,
        renditionCount: 0,
        bytes: 1024,
        allVariants: false,
      },
    ];
    app.agent.video.serveManager.serve = async (originId, options) => {
      requestedHost = options?.host;
      return {
        originId,
        playbackUrl: "http://0.0.0.0:30000/index.m3u8",
        baseUrl: "http://0.0.0.0:30000",
        live: false,
      };
    };
    const server = createApiServer(app);

    const response = await server.inject({
      method: "POST",
      url: "/streams/origin-a/serve",
      payload: { host: "0.0.0.0" },
    });

    expect(response.statusCode).toBe(200);
    expect(requestedHost).toBe("0.0.0.0");
    expect(response.json()).toMatchObject({
      ok: true,
      serve: {
        originId: "origin-a",
        playbackUrl: "http://0.0.0.0:30000/index.m3u8",
      },
    });
    expect(response.json().serve).toHaveProperty("networkPlaybackUrl");
    await server.close();
  });

  it("accepts Clark register and heartbeat over WebSocket", async () => {
    const server = createApiServer(makeFakeApp());
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected server address");
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    await once(socket, "open");

    socket.send(JSON.stringify({
      version: 1,
      type: "client.register",
      timestamp: new Date().toISOString(),
      payload: {
        client: {
          clientId: "clark-test",
          clientName: "Clark Test",
          hostname: "notebook",
          machineName: "notebook",
          platform: "linux",
          arch: "x64",
          version: "0.1.0",
          capabilities: [
            {
              name: "system.info",
              description: "Retorna info",
              requiresApproval: false,
            },
          ],
          providers: [],
          startedAt: new Date().toISOString(),
        },
      },
    }));

    const [registeredRaw] = await once(socket, "message");
    const registered = JSON.parse(String(registeredRaw)) as {
      type: string;
      payload: { connectionId: string; accepted: boolean };
    };
    expect(registered.type).toBe("server.registered");
    expect(registered.payload.accepted).toBe(true);
    expect(typeof registered.payload.connectionId).toBe("string");

    socket.send(JSON.stringify({
      version: 1,
      type: "client.heartbeat",
      timestamp: new Date().toISOString(),
      payload: {
        clientId: "clark-test",
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 25));

    const health = await server.inject({
      method: "GET",
      url: "/health",
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().metrics.edgeRuntime.connectedClients).toBe(1);

    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await server.close();
  });

  it("dispatches edge task request and resolves client.task.result over WebSocket", async () => {
    const app = makeFakeApp();
    const server = createApiServer(app);
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected server address");
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    await once(socket, "open");

    socket.send(JSON.stringify({
      version: 1,
      type: "client.register",
      timestamp: new Date().toISOString(),
      payload: {
        client: {
          clientId: "clark-test",
          clientName: "Clark Test",
          hostname: "notebook",
          machineName: "notebook",
          platform: "linux",
          arch: "x64",
          version: "0.1.0",
          capabilities: [
            {
              name: "system.info",
              description: "Retorna info",
              requiresApproval: false,
            },
          ],
          providers: [],
          startedAt: new Date().toISOString(),
        },
      },
    }));

    await once(socket, "message");

    socket.on("message", (raw: unknown) => {
      const parsed = JSON.parse(String(raw)) as {
        type: string;
        payload?: { task?: { id: string; capability: string; input: unknown } };
      };
      if (parsed.type !== "server.task.request" || !parsed.payload?.task) {
        return;
      }

      socket.send(JSON.stringify({
        version: 1,
        type: "client.task.result",
        timestamp: new Date().toISOString(),
        payload: {
          result: {
            taskId: parsed.payload.task.id,
            capability: parsed.payload.task.capability,
            success: true,
            output: {
              hostname: "notebook",
              receivedInput: parsed.payload.task.input,
            },
            durationMs: 11,
          },
        },
      }));
    });

    const result = await app.agent.runtimes.edge.dispatchTask({
      capability: "system.info",
      input: { verbose: true },
      timeoutMs: 500,
    });

    expect(result.ok).toBe(true);
    expect(result.clientId).toBe("clark-test");
    expect(result.capability).toBe("system.info");
    expect(result.output).toEqual({
      hostname: "notebook",
      receivedInput: { verbose: true },
    });

    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await server.close();
  });

  it("replays idempotent /chat and rejects key conflict", async () => {
    const server = createApiServer(makeFakeApp());

    const first = await server.inject({
      method: "POST",
      url: "/chat",
      headers: { "x-idempotency-key": "same-key" },
      payload: { sessionKey: "s1", message: "oi" },
    });
    expect(first.statusCode).toBe(200);

    const replay = await server.inject({
      method: "POST",
      url: "/chat",
      headers: { "x-idempotency-key": "same-key" },
      payload: { sessionKey: "s1", message: "oi" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["x-idempotency-replayed"]).toBe("true");

    const conflict = await server.inject({
      method: "POST",
      url: "/chat",
      headers: { "x-idempotency-key": "same-key" },
      payload: { sessionKey: "s1", message: "mensagem diferente" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

    await server.close();
  });

  it("upserts and pauses/resumes schedules through API", async () => {
    const server = createApiServer(makeFakeApp());

    const create = await server.inject({
      method: "POST",
      url: "/schedules",
      payload: {
        id: "heartbeat.secondary",
        type: "heartbeat",
        intervalMs: 5000,
        enabled: true,
      },
    });
    expect(create.statusCode).toBe(200);
    expect(create.json().schedule.id).toBe("heartbeat.secondary");

    const pause = await server.inject({
      method: "POST",
      url: "/schedules/heartbeat.secondary/pause",
    });
    expect(pause.statusCode).toBe(200);
    expect(pause.json().schedule.enabled).toBe(false);

    const resume = await server.inject({
      method: "POST",
      url: "/schedules/heartbeat.secondary/resume",
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().schedule.enabled).toBe(true);

    await server.close();
  });

  it("cancels job through API", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "POST",
      url: "/jobs/j123/cancel",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.canceled).toBe(true);
    expect(body.job.id).toBe("j123");
    await server.close();
  });

  it("generates plan through API", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "POST",
      url: "/plans/generate",
      payload: {
        sessionKey: "s1",
        objective: "transcodar e gerar hls",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.plan.id).toBe("plan-generated");
    expect(body.plan.title.toLowerCase()).toContain("transcodar");
    await server.close();
  });

  it("executes next plan step through API", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "POST",
      url: "/plans/plan-1/execute-next",
      payload: {
        sessionKey: "s1",
        inputs: {
          inputPath: "/tmp/in.mp4",
          outputPath: "/tmp/out.mp4",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe("transcode");
    expect(body.execution.refId).toBe("job-xyz");
    await server.close();
  });

  it("reconciles plans through API", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "POST",
      url: "/plans/reconcile",
      payload: {
        limit: 50,
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.scannedPlans).toBe(2);
    expect(body.updatedPlans).toBe(1);
    expect(body.updatedSteps).toBe(1);
    await server.close();
  });

  it("cancels plan through API", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "POST",
      url: "/plans/plan-1/cancel",
      payload: {
        note: "cancelado pelo operador",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.plan.status).toBe("canceled");
    await server.close();
  });

  it("lists and resolves exec approvals through API", async () => {
    const app = makeFakeApp();
    app.agent.runtimes.shell = {
      listApprovals: async () => [
        {
          id: "a1",
          command: "rm -rf /tmp/x",
          cwd: "/tmp",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          status: "pending",
        },
      ],
      resolveApproval: async (id: string, decision: "approved" | "denied") => ({
        id,
        command: "rm -rf /tmp/x",
        cwd: "/tmp",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: decision,
        decidedAt: new Date().toISOString(),
      }),
    } as unknown as KaelApp["agent"]["runtimes"]["shell"];
    const server = createApiServer(app);

    const listed = await server.inject({
      method: "GET",
      url: "/exec/approvals?status=open",
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().approvals.length).toBe(1);

    const approved = await server.inject({
      method: "POST",
      url: "/exec/approvals/a1/approve",
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().approval.status).toBe("approved");

    await server.close();
  });

  it("lists, upserts and resolves MCP approvals through API", async () => {
    const server = createApiServer(makeFakeApp());

    const listServers = await server.inject({
      method: "GET",
      url: "/mcp/servers",
    });
    expect(listServers.statusCode).toBe(200);
    expect(listServers.json().servers[0].name).toBe("local-http");

    const upsert = await server.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "local-stdio",
        transport: "stdio",
        target: "bun run ./mcp.ts",
        enabled: true,
        requireApproval: true,
      },
    });
    expect(upsert.statusCode).toBe(200);
    expect(upsert.json().server.transport).toBe("stdio");

    const listApprovals = await server.inject({
      method: "GET",
      url: "/mcp/approvals",
    });
    expect(listApprovals.statusCode).toBe(200);
    expect(listApprovals.json().approvals[0].id).toBe("mcp-ap-1");

    const approve = await server.inject({
      method: "POST",
      url: "/mcp/approvals/mcp-ap-1/approve",
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().approval.status).toBe("approved");

    await server.close();
  });
});
