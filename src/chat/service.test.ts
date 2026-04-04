import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService } from "./service.js";
import { ProjectContextService } from "../projects/service.js";
import { SessionStore } from "../session/store.js";
import { SkillService } from "../skills/service.js";
import type { EngineToolingNamespaces } from "../engine/types.js";

const roots: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-chat-service-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0, roots.length).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function createTooling(): EngineToolingNamespaces {
  return {
    video: {
      startTranscode: async () => {
        throw new Error("unused");
      },
      startConvertHls: async () => {
        throw new Error("unused");
      },
      startCaptureStream: async () => {
        throw new Error("unused");
      },
      startProbeMedia: async () => {
        throw new Error("unused");
      },
      videoHlsInspect: async () => ({ ok: true, url: "", finalUrl: "", playlistType: "unknown", variants: [], renditions: [], segments: [], errors: [] }),
      videoProbe: async () => ({ ok: true, input: "", timeoutMs: 1000, errors: [] }),
    },
    jobs: {
      listJobs: () => [],
      getJob: () => null,
      getJobLog: async ({ jobId }: { jobId: string }) => ({ jobId, found: false }),
    },
    system: {
      execCommand: async () => ({ id: "exec-1", command: "true", cwd: ".", status: "completed", startedAt: new Date().toISOString(), outputTail: "" }),
      processCommand: async () => ({ ok: true, action: "list", sessions: [] }),
    },
    mcp: {
      mcpList: async () => ({ ok: true, command: "mcporter list", schema: false, format: "json", items: [] }),
      mcpCall: async () => ({ ok: true, command: "mcporter call", target: "stub.tool", format: "json", output: {} }),
    },
    edge: {
      edgeList: () => [],
      edgeCall: async () => ({ ok: true, capability: "system.info", output: {} }),
      youboraMetricsGet: async () => ({ ok: true, capability: "youbora.metrics.get", output: {} }),
      youboraRawdataGet: async () => ({ ok: true, capability: "youbora.rawdata.get", output: {} }),
      youboraEventsGet: async () => ({ ok: true, capability: "youbora.events.get", output: {} }),
    },
    memory: {
      memorySearch: async () => [],
      memoryGet: async () => ({ path: "MEMORY.md", text: "", startLine: 1, endLine: 1 }),
      memoryWrite: async () => ({ path: "memory/2026-01-01.md" }),
    },
    workspace: {
      workspaceSearch: async () => [],
      workspaceRead: async () => ({ path: "README.md", text: "", startLine: 1, endLine: 1 }),
    },
    web: {
      webSearch: async () => ({ provider: "tavily", query: "", results: [] }),
      webFetch: async () => ({ ok: true, url: "", finalUrl: "", status: 200, contentType: "text/plain", text: "", excerpt: "", title: "", fetchedAt: new Date().toISOString(), fromCache: false }),
      webResearch: async () => ({ provider: "tavily", query: "", summary: "", results: [] }),
    },
    browser: {
      browserCommand: async () => ({ status: "started", action: "start", sessionKey: "s1" }),
      browserRuntimeTelemetry: () => ({ enabled: true, activeSessions: 0, totalCommands: 0, failedCommands: 0, expiredSessions: 0, artifactDir: ".kael-data/browser/artifacts" }),
    },
    image: {
      imageGenerate: async () => ({ kind: "image", dataBase64: "aGVsbG8=", mimeType: "image/png", fileName: "img.png" }),
    },
    plans: {
      planCreate: async () => ({ id: "p1", sessionKey: "s1", title: "plan", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [] }),
      planGenerate: async () => ({ id: "p1", sessionKey: "s1", title: "plan", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [] }),
      planList: async () => [],
      planGet: async () => null,
      planUpdateStep: async () => null,
      planNextAction: async () => null,
      planExecuteNext: async () => ({ ok: true, plan: { id: "p1", sessionKey: "s1", title: "plan", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [] }, stepIndex: 0, message: "noop" }),
      planReconcile: async () => ({ ok: true, reconciled: 0, plans: [] }),
    },
  } as unknown as EngineToolingNamespaces;
}

describe("ChatService project retrieval", () => {
  it("injects project documents context for strong project question matches", async () => {
    const root = await createWorkspace();
    const sessions = new SessionStore(path.join(root, ".kael-data"));
    await sessions.init();
    const projects = new ProjectContextService(root);
    await projects.upsertDocument({
      project: "ios-app",
      path: "params.md",
      title: "iOS Params",
      description: "Parametros e contratos do app iOS.",
      tags: ["ios", "params"],
      content: "O iOS envia o parametro x no body de /session/start.",
    });
    let capturedMessage = "";
    const orchestrator = {
      checkCompactionNeed: async () => ({
        compacted: false,
        reason: "below_threshold" as const,
        summarizedMessages: 0,
        totalMessages: 0,
        totalChars: 0,
      }),
      runConversationTurn: async ({ message }: { message: string }) => {
        capturedMessage = message;
        return { reply: "ok", artifacts: [] };
      },
      getEngineRuntimeTelemetrySnapshot: () => ({ timeouts: 0, toolCallsByName: {}, blockedCallsByTool: {} }),
    } as unknown as ConstructorParameters<typeof ChatService>[2];

    const tooling = createTooling();

    const chat = new ChatService(
      sessions,
      { process: async () => ({ ok: true, action: "list", sessions: [] }) } as never,
      orchestrator as never,
      {
        preprocess: async ({ message }: { message: string }) => ({ message, applied: false, details: [] }),
        getRuntimeTelemetrySnapshot: () => ({
          processedRequests: 0,
          appliedRequests: 0,
          imageDescribed: 0,
          audioTranscribed: 0,
          failures: 0,
          processedAttachments: 0,
          skippedTooLarge: 0,
          skippedBySourceLimit: 0,
          skippedByTotalBytesBudget: 0,
          skippedByProcessingBudget: 0,
        }),
      },
      {} as never,
      tooling,
      projects,
      new SkillService(root),
    );

    const result = await chat.handleMessage({
      sessionKey: "s1",
      message: "Como o iOS envia o parametro x?",
    });

    expect(result.reply).toBe("ok");
    expect(capturedMessage).toContain("[project_documents_context]");
    expect(capturedMessage).toContain("project=ios-app path=params.md");
    expect(capturedMessage).toContain("O iOS envia o parametro x no body de /session/start.");
  });

  it("does not inject project context for generic chat", async () => {
    const root = await createWorkspace();
    const sessions = new SessionStore(path.join(root, ".kael-data"));
    await sessions.init();
    let capturedMessage = "";
    const orchestrator = {
      checkCompactionNeed: async () => ({
        compacted: false,
        reason: "below_threshold" as const,
        summarizedMessages: 0,
        totalMessages: 0,
        totalChars: 0,
      }),
      runConversationTurn: async ({ message }: { message: string }) => {
        capturedMessage = message;
        return { reply: "ok", artifacts: [] };
      },
      getEngineRuntimeTelemetrySnapshot: () => ({ timeouts: 0, toolCallsByName: {}, blockedCallsByTool: {} }),
    } as unknown as ConstructorParameters<typeof ChatService>[2];

    const tooling = createTooling();

    const chat = new ChatService(
      sessions,
      { process: async () => ({ ok: true, action: "list", sessions: [] }) } as never,
      orchestrator as never,
      {
        preprocess: async ({ message }: { message: string }) => ({ message, applied: false, details: [] }),
        getRuntimeTelemetrySnapshot: () => ({
          processedRequests: 0,
          appliedRequests: 0,
          imageDescribed: 0,
          audioTranscribed: 0,
          failures: 0,
          processedAttachments: 0,
          skippedTooLarge: 0,
          skippedBySourceLimit: 0,
          skippedByTotalBytesBudget: 0,
          skippedByProcessingBudget: 0,
        }),
      },
      {} as never,
      tooling,
      new ProjectContextService(root),
      new SkillService(root),
    );

    await chat.handleMessage({
      sessionKey: "s1",
      message: "oi, tudo bem?",
    });

    expect(capturedMessage).not.toContain("[project_documents_context]");
  });

  it("uses @project hint to scaffold and inject project context", async () => {
    const root = await createWorkspace();
    const sessions = new SessionStore(path.join(root, ".kael-data"));
    await sessions.init();
    let capturedMessage = "";
    let capturedProject: string | undefined;
    const orchestrator = {
      checkCompactionNeed: async () => ({
        compacted: false,
        reason: "below_threshold" as const,
        summarizedMessages: 0,
        totalMessages: 0,
        totalChars: 0,
      }),
      runConversationTurn: async ({ message }: { message: string }) => {
        capturedMessage = message;
        return { reply: "ok", artifacts: [] };
      },
      getEngineRuntimeTelemetrySnapshot: () => ({ timeouts: 0, toolCallsByName: {}, blockedCallsByTool: {} }),
    } as unknown as ConstructorParameters<typeof ChatService>[2];

    const projects = new ProjectContextService(root);
    const originalSearch = projects.search.bind(projects);
    projects.search = async (params) => {
      capturedProject = params.project;
      return originalSearch(params);
    };
    const tooling = createTooling();

    const chat = new ChatService(
      sessions,
      { process: async () => ({ ok: true, action: "list", sessions: [] }) } as never,
      orchestrator as never,
      {
        preprocess: async ({ message }: { message: string }) => ({ message, applied: false, details: [] }),
        getRuntimeTelemetrySnapshot: () => ({
          processedRequests: 0,
          appliedRequests: 0,
          imageDescribed: 0,
          audioTranscribed: 0,
          failures: 0,
          processedAttachments: 0,
          skippedTooLarge: 0,
          skippedBySourceLimit: 0,
          skippedByTotalBytesBudget: 0,
          skippedByProcessingBudget: 0,
        }),
      },
      {} as never,
      tooling,
      projects,
      new SkillService(root),
    );

    await chat.handleMessage({
      sessionKey: "s1",
      message: "@ios-app como o parametro x e enviado?",
    });

    expect(capturedProject).toBe("ios-app");
    expect(capturedMessage).toContain("[project_scope]");
    expect(capturedMessage).toContain("[project_context]");
    expect(capturedMessage).toContain("project=ios-app");
    expect(capturedMessage).toContain("user_message=como o parametro x e enviado?");
    expect(capturedMessage).not.toContain("@ios-app");
    const scaffoldPath = path.join(root, ".kael", "projects", "ios-app", "PROJECT.md");
    await expect(fs.readFile(scaffoldPath, "utf-8")).resolves.toContain("# ios-app");
  });
});
