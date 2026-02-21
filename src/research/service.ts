import path from "node:path";
import { kaelLogger } from "../infra/logger.js";
import { readJsonFile, writeJsonFile } from "../infra/fs.js";
import { fetchWithSsrFGuard } from "./ssrf-guard.js";
import type { HostLookup } from "./ssrf-guard.js";
import { wrapExternalContent } from "../security/external-content.js";
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

function wrapWebFetchText(value: string | undefined): string | undefined {
  if (!value || !value.trim()) {
    return value;
  }
  return wrapExternalContent(value, { source: "web_fetch", includeWarning: false });
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

function extractByTag(html: string, tag: string): string[] {
  const out: string[] = [];
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1] ?? "";
    const text = stripHtml(raw);
    if (text) {
      out.push(text);
    }
  }
  return out;
}

function extractLikelyContentDivs(html: string): string[] {
  const out: string[] = [];
  const regex =
    /<(section|div)\b[^>]*(?:id|class)=["'][^"']*(content|article|main|post|entry|body)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[3] ?? "";
    const text = stripHtml(raw);
    if (text) {
      out.push(text);
    }
  }
  return out;
}

function removeNoiseBlocks(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");
}

function pickBestCandidate(candidates: string[]): string | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  const ranked = [...candidates]
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0)
    .sort((a, b) => b.length - a.length);
  return ranked[0];
}

function extractReadableHtmlText(html: string): string {
  const withoutNoise = removeNoiseBlocks(html);
  const candidates = [
    ...extractByTag(withoutNoise, "article"),
    ...extractByTag(withoutNoise, "main"),
    ...extractLikelyContentDivs(withoutNoise),
  ];
  const best = pickBestCandidate(candidates);
  if (best && best.length >= 120) {
    return best;
  }
  const bodyMatch = withoutNoise.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) {
    return stripHtml(bodyMatch[1]);
  }
  return stripHtml(withoutNoise);
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

type ReadResponseTextResult = {
  text: string;
  truncated: boolean;
  bytesRead: number;
};

async function readResponseTextLimited(res: Response, maxBytes: number): Promise<ReadResponseTextResult> {
  const body = (res as unknown as { body?: unknown }).body;
  if (
    body &&
    typeof body === "object" &&
    "getReader" in body &&
    typeof (body as { getReader: () => unknown }).getReader === "function"
  ) {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let truncated = false;
    const parts: string[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.byteLength === 0) {
          continue;
        }
        let chunk = value;
        if (bytesRead + chunk.byteLength > maxBytes) {
          const remaining = Math.max(0, maxBytes - bytesRead);
          if (remaining <= 0) {
            truncated = true;
            break;
          }
          chunk = chunk.subarray(0, remaining);
          truncated = true;
        }
        bytesRead += chunk.byteLength;
        parts.push(decoder.decode(chunk, { stream: true }));
        if (truncated || bytesRead >= maxBytes) {
          truncated = true;
          break;
        }
      }
    } finally {
      if (truncated) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
      }
    }
    parts.push(decoder.decode());
    return { text: parts.join(""), truncated, bytesRead };
  }

  const raw = await res.text();
  const encoded = new TextEncoder().encode(raw);
  if (encoded.byteLength <= maxBytes) {
    return { text: raw, truncated: false, bytesRead: encoded.byteLength };
  }
  const clipped = encoded.slice(0, maxBytes);
  return { text: new TextDecoder().decode(clipped), truncated: true, bytesRead: maxBytes };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
}

function scoreRelevance(query: string, source: WebSource): number {
  const terms = Array.from(new Set(tokenize(query)));
  if (terms.length === 0) {
    return clamp01(source.score);
  }
  const haystack = `${source.title ?? ""} ${source.snippet ?? ""} ${source.url}`.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      hits += 1;
    }
  }
  return clamp01(hits / terms.length);
}

function scoreSourceQuality(source: WebSource): number {
  const providerScore = clamp01(source.score);
  let domainScore = 0.45;
  try {
    const parsed = new URL(source.url);
    if (parsed.protocol === "https:") {
      domainScore += 0.15;
    }
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith(".gov") || host.endsWith(".edu") || host.endsWith(".org") || host.endsWith(".mil")) {
      domainScore += 0.2;
    }
    if (/\d/.test(host)) {
      domainScore -= 0.05;
    }
  } catch {
    domainScore -= 0.15;
  }
  return clamp01(providerScore * 0.5 + clamp01(domainScore) * 0.5);
}

function scoreRecency(publishedAt: string | undefined): number {
  if (!publishedAt) {
    return 0.45;
  }
  const timestamp = Date.parse(publishedAt);
  if (!Number.isFinite(timestamp)) {
    return 0.35;
  }
  const ageDays = (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
  if (!Number.isFinite(ageDays)) {
    return 0.35;
  }
  if (ageDays <= 7) {
    return 1;
  }
  if (ageDays <= 30) {
    return 0.85;
  }
  if (ageDays <= 90) {
    return 0.7;
  }
  if (ageDays <= 365) {
    return 0.5;
  }
  if (ageDays <= 365 * 3) {
    return 0.3;
  }
  return 0.15;
}

function scoreFetchQuality(fetchInfo: {
  excerpt?: string;
  contentChars?: number;
  cached?: boolean;
  warning?: string;
} | undefined): number {
  if (!fetchInfo) {
    return 0.35;
  }
  let score = 0.25;
  if ((fetchInfo.excerpt ?? "").trim().length > 0) {
    score += 0.25;
  }
  score += Math.min(0.45, Math.max(0, (fetchInfo.contentChars ?? 0) / 2000));
  if (fetchInfo.cached) {
    score += 0.05;
  }
  if (fetchInfo.warning) {
    score -= 0.3;
  }
  return clamp01(score);
}

function scoreDiversityBonus(domain: string, domainCounts: Map<string, number>): number {
  const count = domainCounts.get(domain) ?? 0;
  if (count <= 1) {
    return 0.05;
  }
  if (count === 2) {
    return 0.02;
  }
  return 0;
}

function rankEvidence(query: string, evidence: WebResearchResult["evidence"]): WebResearchResult["evidence"] {
  const domainCounts = new Map<string, number>();
  for (const item of evidence) {
    const domain = normalizeDomain(item.source.url);
    if (!domain) {
      continue;
    }
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }

  return evidence
    .map((item) => {
      const relevance = scoreRelevance(query, item.source);
      const sourceQuality = scoreSourceQuality(item.source);
      const recency = scoreRecency(item.source.publishedAt);
      const fetchQuality = scoreFetchQuality(item.fetch);
      const diversityBonus = scoreDiversityBonus(normalizeDomain(item.source.url), domainCounts);
      const score = clamp01(
        0.35 * relevance +
          0.25 * sourceQuality +
          0.2 * recency +
          0.2 * fetchQuality +
          diversityBonus,
      );
      return {
        ...item,
        ranking: {
          score: round2(score),
          components: {
            relevance: round2(relevance),
            sourceQuality: round2(sourceQuality),
            recency: round2(recency),
            fetchQuality: round2(fetchQuality),
            diversityBonus: round2(diversityBonus),
          },
        },
      };
    })
    .sort((a, b) => b.ranking.score - a.ranking.score);
}

function computeConfidence(params: {
  evidence: WebResearchResult["evidence"];
  fetchedCount: number;
  uniqueDomainCount: number;
}): { confidence: number; reason: string } {
  const sourceFactor = Math.min(1, params.evidence.length / 5);
  const fetchFactor = Math.min(1, params.fetchedCount / 3);
  const diversityFactor = Math.min(1, params.uniqueDomainCount / 4);
  const topScores = params.evidence.slice(0, 5).map((item) => item.ranking.score);
  const avgRankScore =
    topScores.length > 0 ? topScores.reduce((acc, value) => acc + value, 0) / topScores.length : 0;
  const confidence = round2(
    clamp01(0.2 * sourceFactor + 0.2 * fetchFactor + 0.2 * diversityFactor + 0.4 * avgRankScore),
  );
  const reason = `Ranking medio ${round2(avgRankScore)} em ${params.evidence.length} fontes (${params.fetchedCount} com conteudo extraido, ${params.uniqueDomainCount} dominios distintos).`;
  return { confidence, reason };
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
    const guarded = await fetchWithSsrFGuard({
      url: parsed.toString(),
      fetchImpl: this.fetchImpl,
      lookup: this.hostLookup,
      timeoutMs: this.timeoutMs,
      maxRedirects: this.fetchMaxRedirects,
      headers: {
        "user-agent": "KaelResearchBot/0.1 (+local-agent)",
        accept: "text/html, text/plain;q=0.9, */*;q=0.7",
      },
    });
    const response = guarded.response;
    if (!response.ok) {
      throw new Error(`web_fetch failed status=${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? undefined;
    const bodyResult = await readResponseTextLimited(response, this.fetchMaxResponseBytes);
    const raw = bodyResult.text;
    const warning = bodyResult.truncated
      ? `Response body truncated after ${this.fetchMaxResponseBytes} bytes.`
      : undefined;
    const htmlLike = (contentType ?? "").toLowerCase().includes("html") || raw.includes("<html");
    const title = htmlLike ? extractTitle(raw) : undefined;
    const cleaned = htmlLike ? extractReadableHtmlText(raw) : raw.replace(/\s+/g, " ").trim();
    const content = clip(cleaned, maxChars);
    const excerpt = clip(content, Math.min(300, maxChars));
    const fetchedAt = new Date().toISOString();
    const finalUrl = guarded.finalUrl || response.url || parsed.toString();

    const entry: WebFetchCacheEntry = {
      url: parsed.toString(),
      finalUrl,
      title: wrapWebFetchText(title),
      content: wrapWebFetchText(content) ?? content,
      excerpt: wrapWebFetchText(excerpt) ?? excerpt,
      contentType,
      fetchedAt,
      warning,
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
      externalContent: {
        untrusted: true,
        source: "web_fetch",
        wrapped: true,
      },
      warning,
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
        ranking: {
          score: 0,
          components: {
            relevance: 0,
            sourceQuality: 0,
            recency: 0,
            fetchQuality: 0,
            diversityBonus: 0,
          },
        },
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
    const uniqueDomainCount = new Set(evidence.map((item) => normalizeDomain(item.source.url)).filter(Boolean)).size;
    const { confidence, reason } = computeConfidence({
      evidence,
      fetchedCount,
      uniqueDomainCount,
    });

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
