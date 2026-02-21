import path from "node:path";
import { kaelLogger } from "../infra/logger.js";
import { readJsonFile, writeJsonFile } from "../infra/fs.js";
import type {
  SearchProvider,
  WebFetchResult,
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

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxChars - 3))}...`;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return undefined;
  }
  const text = stripHtml(match[1]).trim();
  return text || undefined;
}

export class ResearchService {
  private readonly enabled: boolean;
  private readonly rootDir: string;
  private readonly defaultMaxResults: number;
  private readonly maxResultsLimit: number;
  private readonly timeoutMs: number;
  private readonly fetchMaxChars: number;
  private readonly fetchCacheTtlMs: number;
  private readonly cachePath: string;

  constructor(
    private readonly provider: SearchProvider,
    cfg: ResearchServiceConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.rootDir = path.join(cfg.dataDir, "research");
    this.enabled = cfg.enabled;
    this.defaultMaxResults = Math.max(1, Math.floor(cfg.defaultMaxResults));
    this.maxResultsLimit = Math.max(this.defaultMaxResults, Math.floor(cfg.maxResultsLimit));
    this.timeoutMs = Math.max(1000, Math.floor(cfg.timeoutMs));
    this.fetchMaxChars = Math.max(500, Math.floor(cfg.fetchMaxChars));
    this.fetchCacheTtlMs = Math.max(0, Math.floor(cfg.fetchCacheTtlMs));
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

    const result: WebSearchResult = {
      answer,
      sources: deduped,
      notes,
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
        };
      }
    }

    const startedAt = Date.now();
    const response = await this.fetchImpl(parsed.toString(), {
      method: "GET",
      headers: {
        "user-agent": "KaelResearchBot/0.1 (+local-agent)",
        accept: "text/html, text/plain;q=0.9, */*;q=0.7",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`web_fetch failed status=${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? undefined;
    const raw = await response.text();
    const htmlLike = (contentType ?? "").toLowerCase().includes("html") || raw.includes("<html");
    const title = htmlLike ? extractTitle(raw) : undefined;
    const cleaned = htmlLike ? stripHtml(raw) : raw.replace(/\s+/g, " ").trim();
    const content = clip(cleaned, maxChars);
    const excerpt = clip(content, Math.min(300, maxChars));
    const fetchedAt = new Date().toISOString();
    const finalUrl = response.url || parsed.toString();

    const entry: WebFetchCacheEntry = {
      url: parsed.toString(),
      finalUrl,
      title,
      content,
      excerpt,
      contentType,
      fetchedAt,
    };
    const nextEntries = {
      ...cache.entries,
      [cacheKey]: entry,
    };
    await writeJsonFile(this.cachePath, {
      updatedAt: fetchedAt,
      entries: nextEntries,
    } satisfies WebFetchCacheFile);

    kaelLogger.info("research.fetch.completed", {
      sessionKey: params.sessionKey,
      url: parsed.toString(),
      finalUrl,
      contentChars: content.length,
      durationMs: Date.now() - startedAt,
      cached: false,
    });

    return {
      ...entry,
      cached: false,
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
