import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ResearchService } from "./service.js";
import type { SearchProvider } from "./types.js";

async function makeService(provider: SearchProvider, fetchImpl?: typeof fetch) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kael-research-"));
  const service = new ResearchService(provider, {
    enabled: true,
    dataDir,
    defaultMaxResults: 4,
    maxResultsLimit: 8,
    timeoutMs: 12000,
    fetchMaxChars: 2000,
    fetchCacheTtlMs: 60_000,
    fetchMaxRedirects: 3,
  }, fetchImpl, async () => [{ address: "93.184.216.34", family: 4 }]);
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

  it("fetches url content and reuses cache inside ttl", async () => {
    const provider: SearchProvider = {
      search: vi.fn(async () => ({ results: [] })),
    };
    const fetchMock = vi.fn(async () =>
      new Response("<html><head><title>Example</title></head><body><h1>Hello</h1><p>World</p></body></html>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      }),
    ) as unknown as typeof fetch;
    const { service } = await makeService(provider, fetchMock);

    const first = await service.fetchUrl({
      sessionKey: "s1",
      url: "https://example.com/page",
    });
    const second = await service.fetchUrl({
      sessionKey: "s1",
      url: "https://example.com/page",
    });

    expect(first.cached).toBe(false);
    expect(first.title).toBe("Example");
    expect(first.content).toContain("Hello");
    expect(second.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("builds multi-source synthesis with confidence", async () => {
    const provider: SearchProvider = {
      search: vi.fn(async () => ({
        results: [
          { title: "Source A", url: "https://a.example.com", snippet: "A snippet", score: 0.9 },
          { title: "Source B", url: "https://b.example.com", snippet: "B snippet", score: 0.8 },
        ],
      })),
    };
    const fetchMock = vi
      .fn(async (url: string | URL | Request) => {
        const asString = String(url);
        const body = asString.includes("a.example.com")
          ? "<html><title>A</title><body>Evidence from source A</body></html>"
          : "<html><title>B</title><body>Evidence from source B</body></html>";
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }) as unknown as typeof fetch;
    const { service } = await makeService(provider, fetchMock);

    const result = await service.research({
      sessionKey: "main",
      query: "compare A and B",
      maxResults: 2,
      fetchTop: 2,
    });

    expect(result.summary).toContain("Evidencias principais");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
