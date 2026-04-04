import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeService } from "./service.js";

const roots: string[] = [];

async function createService(): Promise<{ root: string; service: KnowledgeService }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-knowledge-"));
  roots.push(root);
  const service = new KnowledgeService({ rootDir: root });
  await service.init();
  return { root, service };
}

afterEach(async () => {
  await Promise.all(roots.splice(0, roots.length).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("KnowledgeService", () => {
  it("upserts a note and mirrors json plus markdown", async () => {
    const { root, service } = await createService();
    const saved = await service.upsert({
      project: "android-app",
      topic: "session-id-parameter",
      kind: "fact",
      title: "Android session id parameter",
      answer: "Android envia sessionId no header X-Session-Id.",
      files: ["apps/android/network/SessionInterceptor.kt"],
      evidence: ["Header adicionado no interceptor de requests."],
      tags: ["android", "headers"],
      updatedBy: "codex",
      source: "analysis",
      status: "curated",
      confidence: 0.9,
    });

    expect(saved.id).toBe("android-app--session-id-parameter");
    expect(saved.kind).toBe("fact");
    expect(saved.status).toBe("curated");
    const jsonPath = path.join(root, "notes", "android-app", `${saved.id}.json`);
    const mdPath = path.join(root, "notes", "android-app", `${saved.id}.md`);
    expect(await fs.readFile(jsonPath, "utf-8")).toContain("X-Session-Id");
    expect(await fs.readFile(mdPath, "utf-8")).toContain("# Android session id parameter");
  });

  it("searches notes by project/topic/content", async () => {
    const { service } = await createService();
    await service.upsert({
      project: "ios-app",
      topic: "param-x",
      kind: "fact",
      answer: "iOS envia o parametro x no corpo JSON do endpoint /session/start.",
      files: ["ios/App/Networking/SessionStartRequest.swift"],
      tags: ["ios", "session"],
      status: "curated",
      confidence: 0.85,
    });
    await service.upsert({
      project: "android-app",
      topic: "param-y",
      kind: "analysis",
      answer: "Android envia outro parametro.",
      status: "draft",
    });

    const results = await service.search({ query: "como o ios envia o parametro x", project: "ios-app" });
    expect(results).toHaveLength(1);
    expect(results[0]?.project).toBe("ios-app");
    expect(results[0]?.kind).toBe("fact");
    expect(results[0]?.snippet).toContain("/session/start");
  });

  it("merges tags/files/evidence on repeated upsert", async () => {
    const { service } = await createService();
    await service.upsert({
      project: "android-app",
      topic: "analytics-user-id",
      answer: "Primeira resposta",
      tags: ["android"],
      files: ["A.kt"],
      evidence: ["e1"],
    });
    const saved = await service.upsert({
      project: "android-app",
      topic: "analytics-user-id",
      answer: "Resposta atualizada",
      tags: ["analytics"],
      files: ["B.kt"],
      evidence: ["e2"],
    });

    expect(saved.tags).toEqual(["android", "analytics"]);
    expect(saved.files).toEqual(["A.kt", "B.kt"]);
    expect(saved.evidence).toEqual(["e1", "e2"]);
    expect(saved.answer).toBe("Resposta atualizada");
  });

  it("filters notes by kind", async () => {
    const { service } = await createService();
    await service.upsert({
      project: "mobile-app",
      topic: "auth-header-shape",
      kind: "fact",
      answer: "O header X-Auth leva o token bruto.",
    });
    await service.upsert({
      project: "mobile-app",
      topic: "auth-header-review",
      kind: "analysis",
      answer: "Ha risco de divergencia entre Android e iOS.",
    });

    const results = await service.search({ query: "auth header", project: "mobile-app", kind: "fact" });
    expect(results).toHaveLength(1);
    expect(results[0]?.topic).toBe("auth-header-shape");
  });
});
