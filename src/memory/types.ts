import type { SessionMessage } from "../types.js";

export type MemoryRetrieverEntry = {
  path: string;
  text: string;
};

export type MemorySearchQuery = {
  query: string;
  entries: MemoryRetrieverEntry[];
  maxResults: number;
  maxSnippetChars: number;
};

export interface MemoryRetriever {
  search(params: MemorySearchQuery): Array<{
    path: string;
    startLine: number;
    endLine: number;
    snippet: string;
    score: number;
  }>;
}

export type HeuristicDailyFlushNote = {
  note: string;
  includedMessages: number;
  reason?: string;
};

export interface MemoryPolicy {
  isCompactCommand(input: string): boolean;
  todayDailyRelPath(now?: Date): string;
  buildMemoryFlushPrompt(): string;
  buildLongTermPromotionPrompt(): string;
  buildHeuristicDailyFlushNote(params: {
    sessionKey: string;
    currentMessage: string;
    history: SessionMessage[];
  }): HeuristicDailyFlushNote | null;
}

