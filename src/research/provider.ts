import type { SearchProvider, SearchProviderRequest, SearchProviderResponse, WebSource } from "./types.js";

function normalizeDomainList(items: string[] | undefined): string[] | undefined {
  if (!items || items.length === 0) {
    return undefined;
  }
  const normalized = items
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeResult(result: unknown, fallbackScore: number): WebSource | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const typed = result as {
    title?: unknown;
    url?: unknown;
    content?: unknown;
    published_date?: unknown;
    score?: unknown;
  };
  const url = typeof typed.url === "string" ? typed.url.trim() : "";
  if (!url) {
    return null;
  }
  const title = typeof typed.title === "string" && typed.title.trim() ? typed.title.trim() : url;
  const snippet = typeof typed.content === "string" ? typed.content.trim() : undefined;
  const publishedAt =
    typeof typed.published_date === "string" && typed.published_date.trim()
      ? typed.published_date.trim()
      : undefined;
  const score = typeof typed.score === "number" && Number.isFinite(typed.score) ? typed.score : fallbackScore;

  return {
    title,
    url,
    snippet,
    publishedAt,
    score,
  };
}

export class TavilySearchProvider implements SearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(request: SearchProviderRequest): Promise<SearchProviderResponse> {
    const body = {
      api_key: this.apiKey,
      query: request.query,
      max_results: request.maxResults,
      search_depth: "basic",
      include_answer: true,
      include_raw_content: false,
      include_images: false,
      topic: "general",
      days: request.recencyDays,
      include_domains: normalizeDomainList(request.domainsAllow),
    };

    const response = await this.fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(request.timeoutMs),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`tavily search failed: status=${response.status} body=${bodyText.slice(0, 200)}`);
    }

    const raw = (await response.json()) as {
      answer?: unknown;
      results?: unknown;
    };
    const list = Array.isArray(raw.results) ? raw.results : [];
    const results = list
      .map((item, idx) => normalizeResult(item, Math.max(0, request.maxResults - idx)))
      .filter((item): item is WebSource => Boolean(item));

    return {
      answer: typeof raw.answer === "string" ? raw.answer.trim() : undefined,
      results,
    };
  }
}

export class DisabledSearchProvider implements SearchProvider {
  async search(): Promise<SearchProviderResponse> {
    throw new Error(
      "web_search desabilitado. Configure KAEL_RESEARCH_ENABLED=true e KAEL_RESEARCH_API_KEY para ativar.",
    );
  }
}
