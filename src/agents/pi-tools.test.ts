import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPiTools } from "./pi-tools.js";
import type { AgentContext } from "./context.js";
import type {
  EngineBrowserTooling,
  EngineEdgeTooling,
  EngineImageTooling,
  EngineJobsTooling,
  EngineMcpTooling,
  EngineMemoryTooling,
  EnginePlansTooling,
  EngineSystemTooling,
  EngineToolingInterface,
  EngineVideoTooling,
  EngineWebTooling,
  EngineWorkspaceTooling,
} from "./types.js";

type ToolingOverrides = {
  video?: Partial<EngineVideoTooling>;
  jobs?: Partial<EngineJobsTooling>;
  system?: Partial<EngineSystemTooling>;
  mcp?: Partial<EngineMcpTooling>;
  edge?: Partial<EngineEdgeTooling>;
  memory?: Partial<EngineMemoryTooling>;
  workspace?: Partial<EngineWorkspaceTooling>;
  web?: Partial<EngineWebTooling>;
  browser?: Partial<EngineBrowserTooling>;
  image?: Partial<EngineImageTooling>;
  plans?: Partial<EnginePlansTooling>;
};

function createTooling(overrides: ToolingOverrides = {}): AgentContext {
  const tooling: EngineToolingInterface = {
    video: {
      startTranscode: async () => ({ id: "job-1" } as never),
      startConvertHls: async () => ({ id: "job-2" } as never),
      startCaptureStream: async () => ({ id: "job-3" } as never),
      startPlayVlc: async () => ({ id: "job-5" } as never),
      videoHlsInspect: async () => ({
        ok: true,
        url: "https://example.com/master.m3u8",
        finalUrl: "https://example.com/master.m3u8",
        playlistType: "master" as const,
        variants: [],
        renditions: [],
        segments: [],
        errors: [],
      }),
      videoProbe: async () => ({
        ok: true,
        input: "input.mp4",
        timeoutMs: 1000,
        streams: [],
        errors: [],
      }),
      videoGenerateImage: undefined,
      playbackAnalyze: undefined,
      streamList: async () => [],
      streamClone: async () => { throw new Error("not used"); },
      streamServe: async () => { throw new Error("not used"); },
      streamStop: async () => { throw new Error("not used"); },
      ...overrides.video,
    },
    jobs: {
      listJobs: () => [],
      getJob: () => null,
      getJobLog: async ({ jobId }) => ({ jobId, found: false }),
      ...overrides.jobs,
    },
    system: {
      execCommand: async () => ({
          id: "exec-1",
          command: "true",
          cwd: ".",
          status: "completed",
          startedAt: new Date().toISOString(),
          outputTail: "",
        }),
      processCommand: async () => ({ ok: true, action: "list", sessions: [] }),
      ...overrides.system,
    },
    mcp: {
      mcpList: async () => ({ ok: true, command: "mcporter list", schema: false, format: "json", items: [] }),
      mcpCall: async () => ({
          ok: true,
          command: "mcporter call stub",
          target: "stub.call",
          format: "json",
          output: {},
        }),
      ...overrides.mcp,
    },
    edge: {
      edgeList: () => [],
      edgeCall: async ({ capability }) => ({ ok: true, taskId: "edge-1", capability, output: {} }),
      youboraMetricsGet: async () => ({ ok: true, taskId: "yb-1", capability: "youbora.metrics.get", output: {} }),
      youboraRawdataGet: async () => ({ ok: true, taskId: "yb-2", capability: "youbora.rawdata.get", output: {} }),
      youboraEventsGet: async () => ({ ok: true, taskId: "yb-3", capability: "youbora.events.get", output: {} }),
      ...overrides.edge,
    },
    memory: {
      memorySearch: async () => [],
      memoryGet: async () => ({ path: "MEMORY.md", text: "", startLine: 1, endLine: 1 }),
      memoryWrite: async () => ({ path: "memory/2026-01-01.md" }),
      ...overrides.memory,
    },
    workspace: {
      workspaceSearch: async () => [],
      workspaceRead: async () => ({ path: "README.md", text: "", startLine: 1, endLine: 1 }),
      ...overrides.workspace,
    },
    web: {
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
      ...overrides.web,
    },
    browser: {
      browserCommand: async ({ action }) => ({
          ok: true,
          action,
          status: "started",
          message: "ok",
        }),
      browserRuntimeTelemetry: () => ({
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
      ...overrides.browser,
    },
    image: {
      imageGenerate: undefined,
      ...overrides.image,
    },
    plans: {
      planCreate: async () => ({ id: "p1" } as never),
      planGenerate: async () => ({ id: "p1" } as never),
      planList: () => [],
      planGet: () => null,
      planUpdateStep: async () => null,
      planNextAction: () => null,
      planExecuteNext: async () => ({ ok: false, reason: "no_next_step", message: "none" }),
      planReconcile: async () => ({ scannedPlans: 0, updatedPlans: 0, updatedSteps: 0 }),
      ...overrides.plans,
    },
  };
  const edge = {
    listCapabilities: () => tooling.edge.edgeList(),
    dispatchTask: ({ capability, input, clientId, timeoutMs }: any) => {
      if (capability === "youbora.metrics.get") {
        const payload = (input ?? {}) as { fromDate?: string; toDate?: string; metrics?: string; type?: string; granularity?: string; filters?: unknown };
        return tooling.edge.youboraMetricsGet({
          fromDate: payload.fromDate ?? "last24hours",
          toDate: payload.toDate,
          metrics: payload.metrics,
          type: payload.type,
          granularity: payload.granularity,
          filters: payload.filters,
          clientId,
          timeoutMs,
        });
      }
      if (capability === "youbora.rawdata.get") {
        const payload = (input ?? {}) as { fromDate?: string; toDate?: string; type?: string; filters?: unknown };
        return tooling.edge.youboraRawdataGet({
          fromDate: payload.fromDate ?? "last24hours",
          toDate: payload.toDate,
          type: payload.type,
          filters: payload.filters,
          clientId,
          timeoutMs,
        });
      }
      if (capability === "youbora.events.get") {
        const payload = (input ?? {}) as { fromDate?: string; toDate?: string; type?: string; filters?: unknown };
        return tooling.edge.youboraEventsGet({
          fromDate: payload.fromDate ?? "last24hours",
          toDate: payload.toDate,
          type: payload.type,
          filters: payload.filters,
          clientId,
          timeoutMs,
        });
      }
      return tooling.edge.edgeCall({ capability, input, clientId, timeoutMs });
    },
  };

  return {
    core: {
      sessions: {} as never,
      orchestrator: {} as never,
    },
    runtimes: {
      shell: {
        exec: tooling.system.execCommand,
        process: tooling.system.processCommand,
        listApprovals: async () => [],
        resolveApproval: async () => ({ ok: false, reason: "not_found" } as never),
      } as never,
      mcp: {
        list: tooling.mcp.mcpList,
        call: tooling.mcp.mcpCall,
      } as never,
      edge: edge as never,
      browser: {
        command: tooling.browser.browserCommand,
        getRuntimeTelemetrySnapshot: tooling.browser.browserRuntimeTelemetry,
      } as never,
    },
    services: {
      memory: {
        search: (query: any, maxResults: any) => tooling.memory.memorySearch({ query, maxResults }),
        get: ({ relPath, from, lines }: any) => tooling.memory.memoryGet({ path: relPath, from, lines }),
        write: tooling.memory.memoryWrite,
      } as never,
      workspace: {
        search: tooling.workspace.workspaceSearch,
        read: ({ relPath, from, lines }: any) => tooling.workspace.workspaceRead({ path: relPath, from, lines }),
      } as never,
      research: {
        search: tooling.web.webSearch,
        fetchUrl: tooling.web.webFetch,
        research: tooling.web.webResearch,
      } as never,
      planner: {
        create: tooling.plans.planCreate,
        generate: tooling.plans.planGenerate,
        list: tooling.plans.planList,
        get: (planId: any) => tooling.plans.planGet({ planId }),
        updateStep: tooling.plans.planUpdateStep,
        nextAction: (planId: any) => tooling.plans.planNextAction({ planId }),
        executeNext: tooling.plans.planExecuteNext,
        reconcile: tooling.plans.planReconcile,
      } as never,
      skills: {} as never,
      media: {} as never,
    },
    video: {
      jobs: {
        listJobs: () => tooling.jobs.listJobs(),
        getJob: (jobId: any) => tooling.jobs.getJob({ jobId }),
        getJobLog: async (jobId: any) => {
          const result = await tooling.jobs.getJobLog({ jobId });
          return result.found ? result.log ?? "" : null;
        },
      } as never,
      ffmpeg: {
        startTranscode: tooling.video.startTranscode,
        startConvertHls: tooling.video.startConvertHls,
        startCaptureStream: tooling.video.startCaptureStream,
        startPlayVlc: tooling.video.startPlayVlc,
      } as never,
      inspect: {
        inspectHls: (input: any) => tooling.video.videoHlsInspect({ sessionKey: "test", ...input }),
        probe: (input: any) => tooling.video.videoProbe({ sessionKey: "test", ...input }),
      } as never,
      playbackTriage: {
        analyzeSession: (input: any) => {
          if (!tooling.video.playbackAnalyze) throw new Error("playback_analyze_unavailable");
          return tooling.video.playbackAnalyze({ sessionKey: "test", ...input });
        },
      } as never,
      streamMonitor: {
        startWatch: () => "watch-1",
        stopWatch: () => true,
        getStatus: () => null,
        listWatches: () => [],
        stopAll: () => {},
      },
      streamer: {
        listOrigins: async () => [],
        inspectOrigin: async () => {
          throw new Error("not used");
        },
        cloneHls: (input: any) => tooling.video.streamClone({ sessionKey: "test", ...input }),
        cloneDash: (input: any) => tooling.video.streamClone({ sessionKey: "test", ...input }),
      } as never,
      serveManager: {
        serve: (originId: any) => tooling.video.streamServe({ sessionKey: "test", originId }),
        stop: async (originId: any) => {
          await tooling.video.streamStop({ sessionKey: "test", originId });
          return true;
        },
        isServing: () => false,
      } as never,
    },
    generation: {
      image: {
        generate: async ({ prompt, size }: any) => {
          if (!tooling.image.imageGenerate) throw new Error("image_generate_unavailable");
          return tooling.image.imageGenerate({ sessionKey: "test", prompt, size });
        },
      } as never,
      video: {} as never,
    },
  } satisfies AgentContext;
}

describe("createPiTools image_generate", () => {
  it("returns failed result instead of throwing when generation errors", async () => {
    const tools = createPiTools({
      sessionKey: "s1",
      context: createTooling({
        image: {
          imageGenerate: async () => {
            throw new Error("image backend timeout");
          },
        },
      }),
    });
    const tool = tools.find((item) => item.name === "image_generate");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-1", { prompt: "dragao neon" });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");
    expect(text).toContain("ok=false");
    expect(text).toContain("reason=image_generate_failed");
    expect(text).toContain("image backend timeout");
  });

  it("blocks a second image generation call in same turn budget", async () => {
    const imageGenerate = vi.fn(async () => ({
      kind: "image" as const,
      dataBase64: "aGVsbG8=",
      mimeType: "image/png",
      fileName: "img.png",
    }));
    const tools = createPiTools({
      sessionKey: "s1",
      context: createTooling({
        image: {
          imageGenerate,
        },
      }),
    });
    const tool = tools.find((item) => item.name === "image_generate");
    expect(tool).toBeTruthy();

    const first = await tool!.execute("tc-1", { prompt: "primeira" });
    const second = await tool!.execute("tc-2", { prompt: "segunda" });

    const firstText = String((first.content?.[0] as { text?: unknown })?.text ?? "");
    const secondText = String((second.content?.[0] as { text?: unknown })?.text ?? "");

    expect(firstText).toContain("ok=true");
    expect(secondText).toContain("blocked=true");
    expect(secondText).toContain("image_generate_budget_exceeded:1/1");
    expect(imageGenerate).toHaveBeenCalledTimes(1);
  });
});

describe("createPiTools playback_analyze", () => {
  it("exposes playback_analyze and supports raw log text", async () => {
    const tools = createPiTools({
      sessionKey: "s-playback",
      context: createTooling({
        video: {
          playbackAnalyze: async ({ player, logText }) => ({
            ok: false,
            player,
            summary: "Analise detectou stall e erro fatal.",
            metrics: {
              eventCount: 4,
              errorCount: 1,
              fatalErrorCount: 1,
              rebufferCount: 2,
              startupTimeMs: 4200,
            },
            issues: [
              {
                code: "fatal_error",
                severity: "error",
                summary: "Sessao teve erro fatal.",
                evidence: [String(logText ?? "").slice(0, 30)],
              },
            ],
            recommendations: ["Cruzar logs com manifesto."],
          }),
        },
      }),
    });
    const tool = tools.find((item) => item.name === "playback_analyze");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-playback", {
      player: "hlsjs",
      logText: "[4200ms] playing\n[9000ms] buffer stall\n[15000ms] fatal network error",
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");

    expect(text).toContain("ok=false");
    expect(text).toContain("player=hlsjs");
    expect(text).toContain("fatalErrors=1");
    expect(text).toContain("rebuffer=2");
    expect(text).toContain("fatal_error");
  });

  it("returns failed result when playback context errors", async () => {
    const tools = createPiTools({
      sessionKey: "s-playback-missing",
      context: createTooling({}),
    });
    const tool = tools.find((item) => item.name === "playback_analyze");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-playback", {
      player: "generic",
      logText: "fatal error",
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");
    expect(text).toContain("ok=false");
    expect(text).toContain("playback_analyze_failed");
    expect(text).toContain("playback_analyze_unavailable");
  });
});

describe("createPiTools stream_inspect", () => {
  it("usa inspectOrigin para listar chunks do origin", async () => {
    const inspectOrigin = vi.fn(async () => ({
      id: "osoutros",
      schemaVersion: 1,
      protocol: "hls" as const,
      sourceUrl: "https://example.com/master.m3u8",
      selectedUrl: "https://example.com/media.m3u8",
      finalUrl: "https://example.com/media.m3u8",
      rootDir: "/tmp/osoutros",
      manifestPath: "/tmp/osoutros/index.m3u8",
      playbackPath: "/streams/osoutros/index.m3u8",
      requestedDurationSeconds: 60,
      cumulativeDurationSeconds: 8,
      reachedTargetDuration: false,
      targetDuration: 4,
      segmentCount: 2,
      variantCount: 1,
      renditionCount: 0,
      bytes: 3000,
      allVariants: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      variants: [],
      renditions: [],
      segments: [
        {
          originalIndex: 10,
          sourceUri: "seg-10.ts",
          sourceUrl: "https://example.com/seg-10.ts",
          localUri: "segments/00000-seg-10.ts",
          duration: 4,
          bytes: 1000,
        },
        {
          originalIndex: 11,
          sourceUri: "seg-11.ts",
          sourceUrl: "https://example.com/seg-11.ts",
          localUri: "segments/00001-seg-11.ts",
          duration: 4,
          bytes: 2000,
        },
      ],
    }));
    const context = createTooling({});
    context.video.streamer.inspectOrigin = inspectOrigin as never;
    const tools = createPiTools({
      sessionKey: "s-stream",
      context,
    });
    const tool = tools.find((item) => item.name === "stream_inspect");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-stream", { originId: "osoutros" });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");

    expect(inspectOrigin).toHaveBeenCalledWith("osoutros");
    expect(text).toContain("ok=true");
    expect(text).toContain("segments=2");
    expect(text).toContain("chunksListed=2/2");
    expect(text).toContain("originalIndex=10");
    expect(text).toContain("localUri=segments/00000-seg-10.ts");
  });

  it("usa stream_chunk_exec para executar ffprobe com placeholder do chunk", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "kael-stream-tool-test-"));
    const variantDir = path.join(rootDir, "variants", "000-1920x1080");
    const segmentDir = path.join(variantDir, "segments");
    await fs.mkdir(segmentDir, { recursive: true });
    await fs.writeFile(path.join(segmentDir, "00000-test.ts"), "dummy", "utf-8");
    const inspectOrigin = vi.fn(async () => ({
      id: "osoutros",
      schemaVersion: 1,
      protocol: "hls" as const,
      sourceUrl: "https://example.com/master.m3u8",
      selectedUrl: "https://example.com/media.m3u8",
      finalUrl: "https://example.com/media.m3u8",
      rootDir,
      manifestPath: path.join(rootDir, "index.m3u8"),
      playbackPath: "/streams/osoutros/index.m3u8",
      requestedDurationSeconds: 60,
      cumulativeDurationSeconds: 4,
      reachedTargetDuration: false,
      targetDuration: 4,
      segmentCount: 1,
      variantCount: 1,
      renditionCount: 0,
      bytes: 5,
      allVariants: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      renditions: [],
      segments: [],
      variants: [
        {
          sourceUri: "media.m3u8",
          sourceUrl: "https://example.com/media.m3u8",
          finalUrl: "https://example.com/media.m3u8",
          localUri: "variants/000-1920x1080/index.m3u8",
          manifestPath: path.join(variantDir, "index.m3u8"),
          targetDuration: 4,
          segmentCount: 1,
          cumulativeDurationSeconds: 4,
          reachedTargetDuration: false,
          bytes: 5,
          maps: [],
          segments: [
            {
              originalIndex: 10,
              sourceUri: "seg-10.ts",
              sourceUrl: "https://example.com/seg-10.ts",
              localUri: "segments/00000-test.ts",
              duration: 4,
              bytes: 5,
            },
          ],
        },
      ],
    }));
    const context = createTooling({});
    context.video.streamer.inspectOrigin = inspectOrigin as never;
    const tools = createPiTools({
      sessionKey: "s-stream",
      context,
    });
    const tool = tools.find((item) => item.name === "stream_chunk_exec");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-stream", {
      originId: "osoutros",
      targetKind: "variant",
      targetIndex: 0,
      segmentIndex: 0,
      binary: "ffprobe",
      args: ["-version", "{chunk}"],
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");

    expect(inspectOrigin).toHaveBeenCalledWith("osoutros");
    expect(text).toContain("ok=true");
    expect(text).toContain("binary=ffprobe");
    expect(text).toContain("chunkLocalUri=segments/00000-test.ts");
    expect(text).toContain("ffprobe version");
  });
});

describe("createPiTools browser budget", () => {
  it("bloqueia segunda chamada de browser quando maxBrowserCalls=1", async () => {
    const tools = createPiTools({
      sessionKey: "s-browser",
      context: createTooling({
        browser: {
          browserCommand: async ({ action }) => ({
            ok: true,
            action,
            status: "started",
            message: "ok",
          }),
        },
      }),
      budget: {
        maxToolCalls: 5,
        maxBrowserCalls: 1,
      },
    });
    const tool = tools.find((item) => item.name === "browser");
    expect(tool).toBeTruthy();

    const first = await tool!.execute("tc-1", { action: "start" });
    const second = await tool!.execute("tc-2", { action: "start" });

    const firstText = String((first.content?.[0] as { text?: unknown })?.text ?? "");
    const secondText = String((second.content?.[0] as { text?: unknown })?.text ?? "");

    expect(firstText).toContain("ok=true");
    expect(secondText).toContain("blocked=true");
    expect(secondText).toContain("browser_budget_exceeded:1/1");
  });
});

describe("createPiTools jobs/plans state tools", () => {
  it("exposes jobs_list and jobs_get using tooling state methods", async () => {
    const tools = createPiTools({
      sessionKey: "s-jobs",
      context: createTooling({
        jobs: {
          listJobs: () => [
            {
              id: "job-1",
              capability: "video",
              action: "transcode",
              status: "succeeded",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          getJob: () =>
            ({
              id: "job-1",
              capability: "video",
              action: "transcode",
              status: "succeeded",
              sessionKey: "s1",
              command: "ffmpeg",
              input: "/tmp/in.mp4",
              args: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              logPath: "/tmp/job-1.log",
            }) as never,
        },
      }),
    });
    const listTool = tools.find((item) => item.name === "jobs_list");
    const getTool = tools.find((item) => item.name === "jobs_get");
    expect(listTool).toBeTruthy();
    expect(getTool).toBeTruthy();

    const listResult = await listTool!.execute("tc-list", {});
    const getResult = await getTool!.execute("tc-get", { jobId: "job-1" });
    const listText = String((listResult.content?.[0] as { text?: unknown })?.text ?? "");
    const getText = String((getResult.content?.[0] as { text?: unknown })?.text ?? "");

    expect(listText).toContain("jobs=1");
    expect(listText).toContain("succeeded");
    expect(getText).toContain("found=true");
    expect(getText).toContain("jobId=job-1");
  });

  it("exposes plan_get and returns not found when plan is absent", async () => {
    const tools = createPiTools({
      sessionKey: "s-plan",
      context: createTooling({
        plans: {
          planGet: () => null,
        },
      }),
    });
    const planGetTool = tools.find((item) => item.name === "plan_get");
    expect(planGetTool).toBeTruthy();

    const result = await planGetTool!.execute("tc-plan", { planId: "plan-404" });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");
    expect(text).toContain("found=false");
  });
});

describe("createPiTools edge tools", () => {
  it("exposes edge_list and edge_call using tooling state methods", async () => {
    const tools = createPiTools({
      sessionKey: "s-edge",
      context: createTooling({
        edge: {
          edgeList: () => [
            {
              clientId: "clark-1",
              clientName: "Clark 1",
              connectionId: "conn-1",
              name: "system.info",
              description: "Info",
              requiresApproval: false,
              providerNames: [],
              lastHeartbeatAt: null,
            },
          ],
          edgeCall: async () => ({
            ok: true,
            taskId: "task-1",
            clientId: "clark-1",
            connectionId: "conn-1",
            capability: "system.info",
            durationMs: 12,
            output: { hostname: "notebook" },
          }),
        },
      }),
    });
    const listTool = tools.find((item) => item.name === "edge_list");
    const callTool = tools.find((item) => item.name === "edge_call");
    expect(listTool).toBeTruthy();
    expect(callTool).toBeTruthy();

    const listResult = await listTool!.execute("tc-list", {});
    const callResult = await callTool!.execute("tc-call", {
      capability: "system.info",
      inputJson: "{}",
    });
    const listText = String((listResult.content?.[0] as { text?: unknown })?.text ?? "");
    const callText = String((callResult.content?.[0] as { text?: unknown })?.text ?? "");

    expect(listText).toContain("count=1");
    expect(listText).toContain("system.info");
    expect(callText).toContain("ok=true");
    expect(callText).toContain("taskId=task-1");
    expect(callText).toContain("hostname");
  });

  it("blocks edge_call when edge turn budget is exhausted", async () => {
    const tools = createPiTools({
      sessionKey: "s-edge-budget",
      context: createTooling({
        edge: {
          edgeCall: async () => ({
            ok: true,
            taskId: "task-1",
            capability: "system.info",
            output: {},
          }),
        },
      }),
      budget: {
        maxToolCalls: 5,
        maxEdgeCalls: 1,
      },
    });
    const tool = tools.find((item) => item.name === "edge_call");
    expect(tool).toBeTruthy();

    const first = await tool!.execute("tc-1", { capability: "system.info" });
    const second = await tool!.execute("tc-2", { capability: "system.info" });

    const firstText = String((first.content?.[0] as { text?: unknown })?.text ?? "");
    const secondText = String((second.content?.[0] as { text?: unknown })?.text ?? "");
    expect(firstText).toContain("ok=true");
    expect(secondText).toContain("blocked=true");
    expect(secondText).toContain("edge_call_budget_exceeded:1/1");
  });

  it("exposes youbora_metrics_get as typed wrapper over edge_call", async () => {
    const youboraMetricsGet = vi.fn(async () => ({
      ok: true,
      taskId: "task-yb-1",
      clientId: "clark-1",
      connectionId: "conn-1",
      capability: "youbora.metrics.get",
      durationMs: 18,
      output: { rows: [{ metric: "views", value: 123 }] },
    }));
    const tools = createPiTools({
      sessionKey: "s-youbora",
      context: createTooling({
        edge: {
          youboraMetricsGet,
        },
      }),
    });
    const tool = tools.find((item) => item.name === "youbora_metrics_get");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-yb", {
      fromDate: "last24hours",
      metrics: "views,plays",
      type: "vod",
      clientId: "clark-1",
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");

    expect(youboraMetricsGet).toHaveBeenCalledWith({
      fromDate: "last24hours",
      toDate: undefined,
      metrics: "views,plays",
      type: "vod",
      granularity: undefined,
      filters: undefined,
      clientId: "clark-1",
      timeoutMs: undefined,
    });
    expect(text).toContain("ok=true");
    expect(text).toContain("capability=youbora.metrics.get");
    expect(text).toContain("fromDate=last24hours");
    expect(text).toContain("metrics=views,plays");
  });

  it("exposes youbora_rawdata_get as typed wrapper over tooling method", async () => {
    const youboraRawdataGet = vi.fn(async () => ({
      ok: true,
      taskId: "task-yb-raw-1",
      clientId: "clark-1",
      connectionId: "conn-1",
      capability: "youbora.rawdata.get",
      durationMs: 9,
      output: { rows: [] },
    }));
    const tools = createPiTools({
      sessionKey: "s-youbora-raw",
      context: createTooling({
        edge: {
          youboraRawdataGet,
        },
      }),
    });
    const tool = tools.find((item) => item.name === "youbora_rawdata_get");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-yb-raw", {
      fromDate: "last24hours",
      type: "vod",
      filtersJson: "{\"country\":\"br\"}",
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");

    expect(youboraRawdataGet).toHaveBeenCalledWith({
      fromDate: "last24hours",
      toDate: undefined,
      type: "vod",
      filters: { country: "br" },
      clientId: undefined,
      timeoutMs: undefined,
    });
    expect(text).toContain("capability=youbora.rawdata.get");
  });

  it("exposes youbora_events_get as typed wrapper over tooling method", async () => {
    const youboraEventsGet = vi.fn(async () => ({
      ok: true,
      taskId: "task-yb-events-1",
      clientId: "clark-1",
      connectionId: "conn-1",
      capability: "youbora.events.get",
      durationMs: 9,
      output: { rows: [] },
    }));
    const tools = createPiTools({
      sessionKey: "s-youbora-events",
      context: createTooling({
        edge: {
          youboraEventsGet,
        },
      }),
    });
    const tool = tools.find((item) => item.name === "youbora_events_get");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-yb-events", {
      fromDate: "last24hours",
      type: "live",
      filtersJson: "{\"event\":\"rebuffer\"}",
    });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");

    expect(youboraEventsGet).toHaveBeenCalledWith({
      fromDate: "last24hours",
      toDate: undefined,
      type: "live",
      filters: { event: "rebuffer" },
      clientId: undefined,
      timeoutMs: undefined,
    });
    expect(text).toContain("capability=youbora.events.get");
  });
});

describe("createPiTools mcp tools", () => {
  it("exposes mcp_list and mcp_call using tooling state methods", async () => {
    const tools = createPiTools({
      sessionKey: "s-mcp",
      context: createTooling({
        mcp: {
          mcpList: async () => ({
            ok: true,
            command: "mcporter list --output json",
            schema: false,
            format: "json",
            items: [{ name: "linear" }],
          }),
          mcpCall: async () => ({
            ok: true,
            command: "mcporter call linear.list_issues --output json",
            target: "linear.list_issues",
            format: "json",
            output: { issues: [{ id: "1" }] },
          }),
        },
      }),
    });
    const listTool = tools.find((item) => item.name === "mcp_list");
    const callTool = tools.find((item) => item.name === "mcp_call");
    expect(listTool).toBeTruthy();
    expect(callTool).toBeTruthy();

    const listResult = await listTool!.execute("tc-list", {});
    const callResult = await callTool!.execute("tc-call", {
      target: "linear.list_issues",
      argumentsJson: "{\"limit\":5}",
    });
    const listText = String((listResult.content?.[0] as { text?: unknown })?.text ?? "");
    const callText = String((callResult.content?.[0] as { text?: unknown })?.text ?? "");

    expect(listText).toContain("ok=true");
    expect(listText).toContain("\"linear\"");
    expect(callText).toContain("target=linear.list_issues");
    expect(callText).toContain("\"issues\"");
  });

  it("blocks mcp calls when turn budget is exhausted", async () => {
    const tools = createPiTools({
      sessionKey: "s-mcp-budget",
      context: createTooling({
        mcp: {
          mcpList: async () => ({
            ok: true,
            command: "mcporter list --output json",
            schema: false,
            format: "json",
            items: [],
          }),
        },
      }),
      budget: {
        maxToolCalls: 5,
        maxMcpCalls: 1,
      },
    });
    const tool = tools.find((item) => item.name === "mcp_list");
    expect(tool).toBeTruthy();

    const first = await tool!.execute("tc-1", {});
    const second = await tool!.execute("tc-2", {});

    const firstText = String((first.content?.[0] as { text?: unknown })?.text ?? "");
    const secondText = String((second.content?.[0] as { text?: unknown })?.text ?? "");
    expect(firstText).toContain("ok=true");
    expect(secondText).toContain("blocked=true");
    expect(secondText).toContain("mcp_call_budget_exceeded:1/1");
  });
});
