import { kaelLogger } from "../infra/logger.js";
import type { MemorySearchFn, MemorySearchParams, MemorySearchResult } from "./types.js";
import {
  MEMORY_SEARCH_PT_STOPWORDS,
  MEMORY_SEARCH_PT_SYNONYMS,
} from "./query-expansion.pt-br.js";

function clip(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxChars - 3))}...`;
}

function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/\p{Diacritic}+/gu, "");
}

function normalizeForSearch(input: string): string {
  return stripDiacritics(input).toLowerCase();
}

function tokenizeQuery(input: string): string[] {
  const normalized = normalizeForSearch(input);
  return normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .filter((item) => !MEMORY_SEARCH_PT_STOPWORDS.has(item));
}

function expandTerms(baseTerms: string[]): { terms: string[]; weights: Map<string, number> } {
  const weights = new Map<string, number>();
  for (const term of baseTerms) {
    weights.set(term, Math.max(weights.get(term) ?? 0, 1));
    for (const synonym of MEMORY_SEARCH_PT_SYNONYMS[term] ?? []) {
      if (synonym.length < 2) continue;
      weights.set(synonym, Math.max(weights.get(synonym) ?? 0, 0.55));
    }
  }
  return { terms: Array.from(weights.keys()), weights };
}

function recencyBoostFromPath(relPath: string): number {
  const match = relPath.match(/^memory\/(\d{4}-\d{2}-\d{2})\.md$/);
  if (!match?.[1]) {
    return relPath === "MEMORY.md" ? 1.35 : 1;
  }
  const then = Date.parse(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(then)) {
    return 1;
  }
  const days = Math.max(0, (Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 1) return 1.2;
  if (days <= 7) return 1.12;
  if (days <= 30) return 1.05;
  return 0.95;
}

export const searchMemoryTexts: MemorySearchFn = (params: MemorySearchParams): MemorySearchResult[] => {
  const normalizedQuery = normalizeForSearch(params.query.trim());
  if (!normalizedQuery) {
    return [];
  }
  const baseTerms = Array.from(new Set(tokenizeQuery(params.query)));
  if (baseTerms.length === 0) {
    return [];
  }
  const { terms, weights } = expandTerms(baseTerms);
  const hits: MemorySearchResult[] = [];

  for (const entry of params.entries) {
    const content = entry.text;
    if (!content.trim()) {
      continue;
    }
    const relPath = entry.path;
    const pathBoost = relPath === "MEMORY.md" ? 1.35 : 1;
    const timeBoost = recencyBoostFromPath(relPath);
    const normalizedContent = normalizeForSearch(content);
    const lines = content.split("\n");

    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx] ?? "";
      const lower = normalizeForSearch(line);
      let score = 0;
      let matchedCount = 0;
      for (const term of terms) {
        if (lower.includes(term)) {
          score += weights.get(term) ?? 1;
          matchedCount += 1;
        }
      }
      if (score <= 0) {
        continue;
      }
      if (baseTerms.length > 1) {
        const phrase = baseTerms.join(" ");
        if (lower.includes(phrase)) {
          score += 2.5;
        }
      }
      if (matchedCount === 1 && score < 0.8 && lower.length < 24) {
        score *= 0.7;
      }
      let fileSupport = 0;
      for (const term of baseTerms) {
        if (normalizedContent.includes(term)) {
          fileSupport += 0.15;
        }
      }
      const finalScore = Number(((score + fileSupport) * pathBoost * timeBoost).toFixed(3));
      const start = Math.max(0, idx - 2);
      const end = Math.min(lines.length - 1, idx + 2);
      const snippet = lines.slice(start, end + 1).join("\n").trim();
      hits.push({
        path: relPath,
        startLine: start + 1,
        endLine: end + 1,
        snippet: clip(snippet, params.maxSnippetChars),
        score: finalScore,
      });
    }
  }

  const results = hits
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      return a.startLine - b.startLine;
    })
    .filter((hit, idx, arr) => {
      if (idx === 0) return true;
      const prev = arr[idx - 1];
      if (!prev) return true;
      return !(prev.path === hit.path && Math.abs(prev.startLine - hit.startLine) <= 1);
    })
    .slice(0, params.maxResults);

  kaelLogger.info("memory.search.finished", {
    query: clip(params.query, 180),
    baseTerms,
    expandedTerms: terms,
    resultCount: results.length,
    topPaths: results.slice(0, 5).map((r) => `${r.path}:${r.startLine}-${r.endLine}`),
  });

  return results;
};
