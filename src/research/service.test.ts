import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ResearchService } from "./service.js";
import type { SearchProvider } from "./types.js";

async function makeService(provider: SearchProvider) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kael-research-"));
  const service = new ResearchService(provider, {
    dataDir,
    defaultMaxResults: 4,
    maxResultsLimit: 8,
    timeoutMs: 12000,
  });
  return { service, dataDir };
}

describe("ResearchService", () => {
  it("searches, dedupes and persists session memory", async () => {
    const provider: SearchProvider = {
      search: vi.fn(async () => ({
        answer: "Resumo pronto",
        results: [
          { title: "A", url: "https://example.com/a", snippet: "a", score: 0.9 },
          { title: "A2", url: "https://example.com/a", snippet: "dup", score: 0.8 },
          { title: "B", url: "https://news.site/b", snippet: "b", score: 0.7 },
        ],
      })),
    };
    const { service, dataDir } = await makeService(provider);
    const result = await service.search({
      sessionKey: "main",
      query: "kael test",
      maxResults: 5,
    });

    expect(result.answer).toContain("Resumo pronto");
    expect(result.sources).toHaveLength(2);

    const memoryPath = path.join(dataDir, "research", "main.json");
    const raw = await fs.readFile(memoryPath, "utf-8");
    const parsed = JSON.parse(raw) as { entries: Array<{ query: string; sources: unknown[] }> };
    expect(parsed.entries.length).toBe(1);
    expect(parsed.entries[0]?.query).toBe("kael test");
    expect(parsed.entries[0]?.sources.length).toBe(2);
  });

  it("applies domainsBlock filter", async () => {
    const provider: SearchProvider = {
      search: vi.fn(async () => ({
        results: [
          { title: "Blocked", url: "https://blocked.com/a", snippet: "a", score: 0.9 },
          { title: "Allowed", url: "https://allowed.com/b", snippet: "b", score: 0.8 },
        ],
      })),
    };
    const { service } = await makeService(provider);

    const result = await service.search({
      sessionKey: "s1",
      query: "filtro",
      domainsBlock: ["blocked.com"],
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.url).toContain("allowed.com");
    expect(result.notes.join(" ")).toContain("domainsBlock");
  });
});
