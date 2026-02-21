import type { WebResearchResult, WebSource } from "./types.js";

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

function normalizeDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
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

export function rankEvidence(
  query: string,
  evidence: WebResearchResult["evidence"],
): WebResearchResult["evidence"] {
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

export function computeConfidence(evidence: WebResearchResult["evidence"]): {
  confidence: number;
  reason: string;
} {
  const fetchedCount = evidence.filter((item) => item.fetch).length;
  const uniqueDomainCount = new Set(evidence.map((item) => normalizeDomain(item.source.url)).filter(Boolean)).size;
  const sourceFactor = Math.min(1, evidence.length / 5);
  const fetchFactor = Math.min(1, fetchedCount / 3);
  const diversityFactor = Math.min(1, uniqueDomainCount / 4);
  const topScores = evidence.slice(0, 5).map((item) => item.ranking.score);
  const avgRankScore =
    topScores.length > 0 ? topScores.reduce((acc, value) => acc + value, 0) / topScores.length : 0;
  const confidence = round2(
    clamp01(0.2 * sourceFactor + 0.2 * fetchFactor + 0.2 * diversityFactor + 0.4 * avgRankScore),
  );
  const reason = `Ranking medio ${round2(avgRankScore)} em ${evidence.length} fontes (${fetchedCount} com conteudo extraido, ${uniqueDomainCount} dominios distintos).`;
  return { confidence, reason };
}
