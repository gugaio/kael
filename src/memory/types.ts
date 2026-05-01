export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
};

export type MemoryEntry = {
  path: string;
  text: string;
};

export type MemorySearchParams = {
  query: string;
  entries: MemoryEntry[];
  maxResults: number;
  maxSnippetChars: number;
};

export type MemorySearchFn = (params: MemorySearchParams) => MemorySearchResult[];
