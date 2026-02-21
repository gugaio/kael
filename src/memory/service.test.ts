import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryService } from "./service.js";

async function makeService() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-memory-"));
  const service = new MemoryService({
    workspaceRoot: root,
    defaultMaxResults: 6,
    maxSnippetChars: 500,
  });
  await service.init();
  return { service, root };
}

describe("MemoryService", () => {
  it("writes daily and long-term memory", async () => {
    const { service, root } = await makeService();

    const daily = await service.write({ content: "lembrar pipeline semanal" });
    const longTerm = await service.write({
      content: "preferencia: logs curtos",
      target: "long_term",
    });

    expect(daily.path.startsWith("memory/")).toBe(true);
    expect(longTerm.path).toBe("MEMORY.md");

    const dailyRaw = await fs.readFile(path.join(root, daily.path), "utf-8");
    const longRaw = await fs.readFile(path.join(root, "MEMORY.md"), "utf-8");
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
});

