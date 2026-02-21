export type WebSearchQuery = {
  query: string;
  maxResults?: number;
  recencyDays?: number;
  domainsAllow?: string[];
  domainsBlock?: string[];
};

export type WebResearchQuery = WebSearchQuery & {
  fetchTop?: number;
  fetchMaxChars?: number;
};

export type WebSource = {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  score: number;
};

export type WebSearchResult = {
  answer: string;
  sources: WebSource[];
  notes: string[];
  externalContent?: {
    untrusted: true;
    source: "web_search";
    wrapped: true;
  };
};

export type WebFetchResult = {
  url: string;
  finalUrl: string;
  title?: string;
  content: string;
  excerpt: string;
  contentType?: string;
  fetchedAt: string;
  cached: boolean;
  warning?: string;
  externalContent?: {
    untrusted: true;
    source: "web_fetch";
    wrapped: true;
  };
};

export type WebEvidenceItem = {
  source: WebSource;
  fetch?: {
    title?: string;
    excerpt: string;
    contentChars: number;
    cached: boolean;
    warning?: string;
  };
  ranking: {
    score: number;
    components: {
      relevance: number;
      sourceQuality: number;
      recency: number;
      fetchQuality: number;
      diversityBonus: number;
    };
  };
};

export type WebResearchResult = {
  query: string;
  summary: string;
  confidence: number;
  confidenceReason: string;
  evidence: WebEvidenceItem[];
  notes: string[];
};

export type SearchProviderRequest = {
  query: string;
  maxResults: number;
  recencyDays?: number;
  domainsAllow?: string[];
  timeoutMs: number;
};

export type SearchProviderResponse = {
  answer?: string;
  results: WebSource[];
};

export type SearchProvider = {
  search: (request: SearchProviderRequest) => Promise<SearchProviderResponse>;
};
