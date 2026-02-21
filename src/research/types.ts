export type WebSearchQuery = {
  query: string;
  maxResults?: number;
  recencyDays?: number;
  domainsAllow?: string[];
  domainsBlock?: string[];
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

