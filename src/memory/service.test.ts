import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryService } from "./service.js";

async function makeService() {
  return makeServiceWithOptions();
}

async function makeServiceWithOptions(options?: ConstructorParameters<typeof MemoryService>[0]["semanticDedupe"]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-memory-"));
  const storageRoot = path.join(root, ".kael", "data", "memory");
  const service = new MemoryService({
    workspaceRoot: root,
    storageRoot,
    defaultMaxResults: 6,
    maxSnippetChars: 500,
    semanticDedupe: options,
  });
  await service.init();
  return { service, root, storageRoot };
}

describe("MemoryService", () => {
  it("writes daily and long-term memory", async () => {
    const { service, storageRoot } = await makeService();

    const daily = await service.write({ content: "lembrar pipeline semanal" });
    const longTerm = await service.write({
      content: "preferencia: logs curtos",
      target: "long_term",
    });

    expect(daily.path.startsWith("memory/")).toBe(true);
    expect(longTerm.path).toBe("MEMORY.md");

    const dailyRaw = await fs.readFile(path.join(storageRoot, "daily", path.basename(daily.path)), "utf-8");
    const longRaw = await fs.readFile(path.join(storageRoot, "MEMORY.md"), "utf-8");
    expect(dailyRaw).toContain("lembrar pipeline semanal");
    expect(longRaw).toContain("preferencia: logs curtos");
  });

  it("searches memory snippets by query", async () => {
    const { service } = await makeService();
    await service.write({ content: "configurar transcode para h264 baseline" });
    await service.write({ content: "rodar revisão do scheduler toda sexta", target: "long_term" });

    const hits = await service.search("scheduler");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].snippet.toLowerCase()).toContain("scheduler");
    expect(hits[0].path).toBe("MEMORY.md");
  });

  it("reads only allowed memory paths", async () => {
    const { service } = await makeService();
    await service.write({ content: "nota diaria 1" });

    const hit = (await service.search("diaria"))[0];
    const result = await service.get({ relPath: hit.path, from: 1, lines: 5 });
    expect(result.text.toLowerCase()).toContain("nota diaria");

    await expect(service.get({ relPath: "../secret.txt" })).rejects.toThrow(
      /only allows MEMORY\.md or memory\/\*\.md paths/,
    );
  });

  it("skips semantically duplicated long-term memory entries", async () => {
    const { service, storageRoot } = await makeService();

    await service.write({
      target: "long_term",
      content: "Preferencia estavel do projeto: respostas objetivas com logs curtos e foco em execucao real.",
    });
    const before = await fs.readFile(path.join(storageRoot, "MEMORY.md"), "utf-8");

    await service.write({
      target: "long_term",
      content: "Preferencia do projeto: foco em execucao real, respostas objetivas e logs curtos.",
    });
    const after = await fs.readFile(path.join(storageRoot, "MEMORY.md"), "utf-8");

    expect(after).toBe(before);
  });

  it("keeps distinct long-term entries when overlap is only partial", async () => {
    const { service, storageRoot } = await makeService();

    await service.write({
      target: "long_term",
      content: "Padrao de operacao: usar logs curtos e foco em execucao real para tarefas de shell.",
    });
    await service.write({
      target: "long_term",
      content: "Padrao de operacao: usar logs curtos, mas incluir checklist completo quando revisar pipeline de video.",
    });

    const raw = await fs.readFile(path.join(storageRoot, "MEMORY.md"), "utf-8");
    const sections = raw.match(/^##\s+/gm) ?? [];
    expect(sections.length).toBe(2);
  });

  it("allows tuning semantic dedupe thresholds via constructor", async () => {
    const { service, storageRoot } = await makeServiceWithOptions({
      minTokens: 999,
    });

    await service.write({
      target: "long_term",
      content: "Preferencia: respostas objetivas com foco em execucao real e logs curtos.",
    });
    await service.write({
      target: "long_term",
      content: "Preferencia: foco em execucao real, respostas objetivas e logs curtos.",
    });

    const raw = await fs.readFile(path.join(storageRoot, "MEMORY.md"), "utf-8");
    const sections = raw.match(/^##\s+/gm) ?? [];
    expect(sections.length).toBe(2);
  });
});
