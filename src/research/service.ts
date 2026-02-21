import path from "node:path";
import { kaelLogger } from "../infra/logger.js";
import { readJsonFile, writeJsonFile } from "../infra/fs.js";
import type { HostLookup } from "./ssrf-guard.js";
import { wrapExternalContent } from "../security/external-content.js";
import { clip, fetchAndExtractWebContent } from "./fetcher.js";
import { computeConfidence, rankEvidence } from "./ranking.js";
import type {
  SearchProvider,
  WebFetchResult,
  WebResearchQuery,
  WebResearchResult,
  WebSearchQuery,
  WebSearchResult,
  WebSource,
} from "./types.js";

type ResearchServiceConfig = {
  enabled: boolean;
  dataDir: string;
  defaultMaxResults: number;
  maxResultsLimit: number;
  timeoutMs: number;
  fetchMaxChars: number;
  fetchCacheTtlMs: number;
  fetchMaxRedirects: number;
  fetchMaxResponseBytes: number;
};

type ResearchMemoryEntry = {
  id: string;
  query: string;
  createdAt: string;
  answer: string;
  sources: WebSource[];
  notes: string[];
};

type ResearchMemoryFile = {
  sessionKey: string;
  updatedAt: string;
  entries: ResearchMemoryEntry[];
};

type WebFetchCacheEntry = {
  url: string;
  finalUrl: string;
  title?: string;
  content: string;
  excerpt: string;
  contentType?: string;
  fetchedAt: string;
  warning?: string;
};

type WebFetchCacheFile = {
  updatedAt: string;
  entries: Record<string, WebFetchCacheEntry>;
};

function normalizeDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function passesBlocklist(url: string, domainsBlock: string[] | undefined): boolean {
  if (!domainsBlock || domainsBlock.length === 0) {
    return true;
  }
  const domain = normalizeDomain(url);
  if (!domain) {
    return true;
  }
  const blocked = new Set(
    domainsBlock.map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0),
  );
  if (blocked.size === 0) {
    return true;
  }
  for (const candidate of blocked) {
    if (domain === candidate || domain.endsWith(`.${candidate}`)) {
      return false;
    }
  }
  return true;
}

function dedupeSources(input: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  const output: WebSource[] = [];
  for (const source of input) {
    const key = source.url.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(source);
  }
  return output;
}

function wrapWebSearchText(value: string | undefined): string | undefined {
  if (!value || !value.trim()) {
    return value;
  }
  return wrapExternalContent(value, { source: "web_search", includeWarning: false });
}

function buildFallbackAnswer(query: string, sources: WebSource[]): string {
  if (sources.length === 0) {
    return `Nao encontrei fontes suficientes para: "${query}".`;
  }
  const preview = sources
    .slice(0, 3)
    .map((item) => `- ${item.title}: ${item.snippet ?? item.url}`)
    .join("\n");
  return `Pesquisa web para: "${query}"\n\n${preview}`;
}

function toMemoryFileFallback(sessionKey: string): ResearchMemoryFile {
  return {
    sessionKey,
    updatedAt: new Date(0).toISOString(),
    entries: [],
  };
}

function emptyEvidenceRanking(): WebResearchResult["evidence"][number]["ranking"] {
  return {
    score: 0,
    components: {
      relevance: 0,
      sourceQuality: 0,
      recency: 0,
      fetchQuality: 0,
      diversityBonus: 0,
    },
  };
}

export class ResearchService {
  private readonly enabled: boolean;
  private readonly rootDir: string;
  private readonly defaultMaxResults: number;
  private readonly maxResultsLimit: number;
  private readonly timeoutMs: number;
  private readonly fetchMaxChars: number;
  private readonly fetchCacheTtlMs: number;
  private readonly fetchMaxRedirects: number;
  private readonly fetchMaxResponseBytes: number;
  private readonly cachePath: string;

  constructor(
    private readonly provider: SearchProvider,
    cfg: ResearchServiceConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly hostLookup?: HostLookup,
  ) {
    this.rootDir = path.join(cfg.dataDir, "research");
    this.enabled = cfg.enabled;
    this.defaultMaxResults = Math.max(1, Math.floor(cfg.defaultMaxResults));
    this.maxResultsLimit = Math.max(this.defaultMaxResults, Math.floor(cfg.maxResultsLimit));
    this.timeoutMs = Math.max(1000, Math.floor(cfg.timeoutMs));
    this.fetchMaxChars = Math.max(500, Math.floor(cfg.fetchMaxChars));
    this.fetchCacheTtlMs = Math.max(0, Math.floor(cfg.fetchCacheTtlMs));
    this.fetchMaxRedirects = Math.max(0, Math.floor(cfg.fetchMaxRedirects));
    this.fetchMaxResponseBytes = Math.max(32_000, Math.floor(cfg.fetchMaxResponseBytes));
    this.cachePath = path.join(this.rootDir, "fetch-cache.json");
  }

  async search(params: { sessionKey: string } & WebSearchQuery): Promise<WebSearchResult> {
    if (!this.enabled) {
      throw new Error("web_search desabilitado. Configure KAEL_RESEARCH_ENABLED=true para ativar.");
    }
    const query = params.query.trim();
    if (!query) {
      throw new Error("web_search query cannot be empty");
    }
    const maxResults = Number.isFinite(params.maxResults ?? NaN)
      ? Math.max(1, Math.min(this.maxResultsLimit, Math.floor(params.maxResults ?? this.defaultMaxResults)))
      : this.defaultMaxResults;

    const startedAt = Date.now();
    const providerResult = await this.provider.search({
      query,
      maxResults,
      recencyDays: params.recencyDays,
      domainsAllow: params.domainsAllow,
      timeoutMs: this.timeoutMs,
    });

    const filtered = providerResult.results.filter((item) => passesBlocklist(item.url, params.domainsBlock));
    const deduped = dedupeSources(filtered).slice(0, maxResults);
    const notes: string[] = [];
    if (filtered.length !== providerResult.results.length) {
      notes.push("Algumas fontes foram removidas por domainsBlock.");
    }
    if (deduped.length === 0) {
      notes.push("Nenhuma fonte valida encontrada; refine a consulta.");
    }

    const answer =
      providerResult.answer && providerResult.answer.trim()
        ? providerResult.answer.trim()
        : buildFallbackAnswer(query, deduped);

    const wrappedSources = deduped.map((item) => ({
      ...item,
      title: wrapWebSearchText(item.title) ?? item.title,
      snippet: wrapWebSearchText(item.snippet),
    }));
    const result: WebSearchResult = {
      answer: wrapWebSearchText(answer) ?? answer,
      sources: wrappedSources,
      notes,
      externalContent: {
        untrusted: true,
        source: "web_search",
        wrapped: true,
      },
    };

    await this.persistEntry(params.sessionKey, query, result);
    kaelLogger.info("research.search.completed", {
      sessionKey: params.sessionKey,
      query,
      sourceCount: deduped.length,
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  async fetchUrl(params: {
    sessionKey: string;
    url: string;
    maxChars?: number;
  }): Promise<WebFetchResult> {
    if (!this.enabled) {
      throw new Error("web_fetch desabilitado. Configure KAEL_RESEARCH_ENABLED=true para ativar.");
    }
    const url = params.url.trim();
    if (!url) {
      throw new Error("web_fetch url cannot be empty");
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("web_fetch url invalida");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("web_fetch suporta apenas urls http/https");
    }

    const maxChars = Number.isFinite(params.maxChars ?? NaN)
      ? Math.max(200, Math.min(this.fetchMaxChars, Math.floor(params.maxChars ?? this.fetchMaxChars)))
      : this.fetchMaxChars;

    const cacheKey = parsed.toString().toLowerCase();
    const cache = await readJsonFile<WebFetchCacheFile>(this.cachePath, {
      updatedAt: new Date(0).toISOString(),
      entries: {},
    });
    const cached = cache.entries[cacheKey];
    if (cached) {
      const ageMs = Date.now() - new Date(cached.fetchedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= this.fetchCacheTtlMs) {
        return {
          ...cached,
          content: clip(cached.content, maxChars),
          excerpt: clip(cached.excerpt, Math.min(300, maxChars)),
          cached: true,
          externalContent: {
            untrusted: true,
            source: "web_fetch",
            wrapped: true,
          },
        };
      }
    }

    const startedAt = Date.now();
    const entry = await fetchAndExtractWebContent({
      url: parsed.toString(),
      fetchImpl: this.fetchImpl,
      lookup: this.hostLookup,
      timeoutMs: this.timeoutMs,
      fetchMaxRedirects: this.fetchMaxRedirects,
      fetchMaxResponseBytes: this.fetchMaxResponseBytes,
      maxChars,
    });
    const nextEntries = {
      ...cache.entries,
      [cacheKey]: entry,
    };
    await writeJsonFile(this.cachePath, {
      updatedAt: entry.fetchedAt,
      entries: nextEntries,
    } satisfies WebFetchCacheFile);

    kaelLogger.info("research.fetch.completed", {
      sessionKey: params.sessionKey,
      url: parsed.toString(),
      finalUrl: entry.finalUrl,
      contentChars: entry.content.length,
      durationMs: Date.now() - startedAt,
      cached: false,
    });

    return {
      ...entry,
      cached: false,
      externalContent: {
        untrusted: true,
        source: "web_fetch",
        wrapped: true,
      },
    };
  }

  async research(params: { sessionKey: string } & WebResearchQuery): Promise<WebResearchResult> {
    const query = params.query.trim();
    if (!query) {
      throw new Error("web_research query cannot be empty");
    }

    const search = await this.search({
      sessionKey: params.sessionKey,
      query,
      maxResults: params.maxResults,
      recencyDays: params.recencyDays,
      domainsAllow: params.domainsAllow,
      domainsBlock: params.domainsBlock,
    });

    const fetchTopRaw = params.fetchTop ?? 3;
    const fetchTop = Math.max(0, Math.min(5, Math.floor(fetchTopRaw)));
    let evidence: WebResearchResult["evidence"] = [];
    const notes = [...search.notes];

    for (const source of search.sources) {
      evidence.push({
        source,
        ranking: emptyEvidenceRanking(),
      });
    }
    evidence = rankEvidence(query, evidence);
    const picked = evidence.slice(0, fetchTop).map((item) => item.source);

    for (let idx = 0; idx < picked.length; idx += 1) {
      const source = picked[idx];
      if (!source) {
        continue;
      }
      try {
        const fetched = await this.fetchUrl({
          sessionKey: params.sessionKey,
          url: source.url,
          maxChars: params.fetchMaxChars,
        });
        const target = evidence.find((item) => item.source.url === source.url);
        if (target) {
          target.fetch = {
            title: fetched.title,
            excerpt: fetched.excerpt,
            contentChars: fetched.content.length,
            cached: fetched.cached,
            warning: fetched.warning,
          };
        }
      } catch (error) {
        notes.push(
          `Falha ao extrair ${source.url}: ${
            error instanceof Error ? error.message : "erro desconhecido"
          }`,
        );
      }
    }
    evidence = rankEvidence(query, evidence);

    const fetchedCount = evidence.filter((item) => item.fetch).length;
    const { confidence, reason } = computeConfidence(evidence);

    const bullets = evidence
      .slice(0, 5)
      .map((item, idx) => {
        const base = `${idx + 1}. ${item.source.title} (${item.source.url})`;
        if (item.fetch?.excerpt) {
          return `${base}\n   - evidência: ${item.fetch.excerpt}`;
        }
        if (item.source.snippet) {
          return `${base}\n   - snippet: ${item.source.snippet}`;
        }
        return base;
      })
      .join("\n");
    const summary = [
      `Pesquisa: "${query}"`,
      "",
      "Evidencias principais:",
      bullets || "- sem evidencias",
      "",
      `Confianca: ${confidence} (${reason})`,
    ].join("\n");

    kaelLogger.info("research.synthesis.completed", {
      sessionKey: params.sessionKey,
      query,
      sourceCount: search.sources.length,
      fetchedCount,
      confidence,
    });

    return {
      query,
      summary,
      confidence,
      confidenceReason: reason,
      evidence,
      notes,
    };
  }

  private memoryPath(sessionKey: string): string {
    const safe = sessionKey.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.rootDir, `${safe}.json`);
  }

  private async persistEntry(sessionKey: string, query: string, result: WebSearchResult): Promise<void> {
    const filePath = this.memoryPath(sessionKey);
    const current = await readJsonFile<ResearchMemoryFile>(filePath, toMemoryFileFallback(sessionKey));
    const entry: ResearchMemoryEntry = {
      id: crypto.randomUUID(),
      query,
      createdAt: new Date().toISOString(),
      answer: result.answer,
      sources: result.sources,
      notes: result.notes,
    };
    const entries = [entry, ...(current.entries ?? [])].slice(0, 50);
    await writeJsonFile(filePath, {
      sessionKey,
      updatedAt: new Date().toISOString(),
      entries,
    } satisfies ResearchMemoryFile);
  }
}
