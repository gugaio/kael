import path from "node:path";
import { kaelLogger } from "../infra/logger.js";
import { readJsonFile, writeJsonFile } from "../infra/fs.js";
import type { SearchProvider, WebSearchQuery, WebSearchResult, WebSource } from "./types.js";

type ResearchServiceConfig = {
  dataDir: string;
  defaultMaxResults: number;
  maxResultsLimit: number;
  timeoutMs: number;
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

export class ResearchService {
  private readonly rootDir: string;
  private readonly defaultMaxResults: number;
  private readonly maxResultsLimit: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly provider: SearchProvider,
    cfg: ResearchServiceConfig,
  ) {
    this.rootDir = path.join(cfg.dataDir, "research");
    this.defaultMaxResults = Math.max(1, Math.floor(cfg.defaultMaxResults));
    this.maxResultsLimit = Math.max(this.defaultMaxResults, Math.floor(cfg.maxResultsLimit));
    this.timeoutMs = Math.max(1000, Math.floor(cfg.timeoutMs));
  }

  async search(params: { sessionKey: string } & WebSearchQuery): Promise<WebSearchResult> {
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
