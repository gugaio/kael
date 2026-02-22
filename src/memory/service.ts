import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureDir } from "../infra/fs.js";
import { kaelLogger } from "../infra/logger.js";

export type MemoryWriteTarget = "daily" | "long_term";

export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
};

export type MemoryGetResult = {
  path: string;
  text: string;
  startLine: number;
  endLine: number;
};

type MemoryServiceConfig = {
  workspaceRoot: string;
  storageRoot?: string;
  defaultMaxResults: number;
  maxSnippetChars: number;
};

function toIsoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function normalizeRelPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function clip(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxChars - 3))}...`;
}

function isMarkdownFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".md");
}

function normalizeForDedupe(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/\p{Diacritic}+/gu, "");
}

function normalizeForSearch(input: string): string {
  return stripDiacritics(input).toLowerCase();
}

const PT_STOPWORDS = new Set([
  "a",
  "o",
  "os",
  "as",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "na",
  "no",
  "nas",
  "nos",
  "um",
  "uma",
  "meu",
  "minha",
  "meus",
  "minhas",
  "qual",
  "quais",
  "que",
  "agora",
  "hoje",
  "ola",
  "oi",
  "kael",
  "novo",
  "novamente",
  "aparece",
  "memoria",
  "teste",
  "so",
  "se",
  "nao",
  "sabe",
  "souber",
]);

const MEMORY_SYNONYMS: Record<string, string[]> = {
  time: ["clube", "torce", "torcida", "futebol"],
  clube: ["time", "torce", "futebol"],
  torce: ["time", "clube", "torcida", "futebol"],
  nome: ["chama", "chamar"],
  chamar: ["nome", "chama"],
  prefere: ["preferencia", "gosta", "favorito"],
  gosto: ["gosta", "preferencia", "favorito"],
  gosta: ["preferencia", "favorito", "curte"],
  favorito: ["preferencia", "gosta"],
  trabalho: ["empresa", "job", "projeto"],
  projeto: ["trabalho", "repo", "kael"],
};

function tokenizeQuery(input: string): string[] {
  const normalized = normalizeForSearch(input);
  return normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .filter((item) => !PT_STOPWORDS.has(item));
}

function expandTerms(baseTerms: string[]): { terms: string[]; weights: Map<string, number> } {
  const weights = new Map<string, number>();
  for (const term of baseTerms) {
    weights.set(term, Math.max(weights.get(term) ?? 0, 1));
    for (const synonym of MEMORY_SYNONYMS[term] ?? []) {
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

export class MemoryService {
  private readonly workspaceRoot: string;
  private readonly storageRoot: string;
  private readonly defaultMaxResults: number;
  private readonly maxSnippetChars: number;
  private readonly longTermPath: string;
  private readonly dailyDir: string;
  private readonly legacyLongTermPath: string;
  private readonly legacyDailyDir: string;

  constructor(cfg: MemoryServiceConfig) {
    this.workspaceRoot = path.resolve(cfg.workspaceRoot);
    this.storageRoot = path.resolve(cfg.storageRoot ?? this.workspaceRoot);
    this.defaultMaxResults = Math.max(1, Math.floor(cfg.defaultMaxResults));
    this.maxSnippetChars = Math.max(200, Math.floor(cfg.maxSnippetChars));
    this.longTermPath = path.join(this.storageRoot, "MEMORY.md");
    this.dailyDir = path.join(this.storageRoot, "daily");
    this.legacyLongTermPath = path.join(this.workspaceRoot, "MEMORY.md");
    this.legacyDailyDir = path.join(this.workspaceRoot, "memory");
  }

  async init(): Promise<void> {
    await ensureDir(this.workspaceRoot);
    await ensureDir(this.storageRoot);
    await ensureDir(this.dailyDir);
    await this.migrateLegacyMemoryIfNeeded();
  }

  async write(params: { content: string; target?: MemoryWriteTarget }): Promise<{ path: string }> {
    const text = params.content.trim();
    if (!text) {
      throw new Error("memory content cannot be empty");
    }

    const now = new Date();
    const stamp = now.toISOString();
    const target = params.target ?? "daily";

    if (target === "long_term") {
      const existing = await fs.readFile(this.longTermPath, "utf-8").catch(() => "");
      const normalizedExisting = normalizeForDedupe(existing);
      const normalizedText = normalizeForDedupe(text);
      if (normalizedText && normalizedExisting.includes(normalizedText)) {
        return { path: "MEMORY.md" };
      }
      const block = `\n\n## ${stamp}\n${text}\n`;
      await fs.appendFile(this.longTermPath, block, "utf-8");
      return { path: "MEMORY.md" };
    }

    const relPath = `memory/${toIsoDate(now)}.md`;
    const absolutePath = path.join(this.dailyDir, `${toIsoDate(now)}.md`);
    await ensureDir(path.dirname(absolutePath));
    const line = `- [${stamp}] ${text}\n`;
    await fs.appendFile(absolutePath, line, "utf-8");
    return { path: relPath };
  }

  async search(query: string, maxResults?: number): Promise<MemorySearchResult[]> {
    const normalizedQuery = normalizeForSearch(query.trim());
    if (!normalizedQuery) {
      return [];
    }
    const baseTerms = Array.from(new Set(tokenizeQuery(query)));
    if (baseTerms.length === 0) {
      return [];
    }
    const { terms, weights } = expandTerms(baseTerms);

    const files = await this.listMemoryFiles();
    const targetResults = Number.isFinite(maxResults ?? NaN)
      ? Math.max(1, Math.floor(maxResults ?? this.defaultMaxResults))
      : this.defaultMaxResults;
    const hits: MemorySearchResult[] = [];
    const topPathsForLog: string[] = [];

    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf-8").catch(() => "");
      if (!content.trim()) {
        continue;
      }
      const relPath = this.toRelativeMemoryPath(filePath);
      const pathBoost = relPath === "MEMORY.md" ? 1.35 : 1;
      const timeBoost = recencyBoostFromPath(relPath);
      const normalizedContent = normalizeForSearch(content);
      const lines = content.split("\n");
      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
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
        // Penaliza hit muito fraco de sinonimo isolado em linha curta.
        if (matchedCount === 1 && score < 0.8 && lower.length < 24) {
          score *= 0.7;
        }
        // Boost se termos-base aparecem em qualquer parte do arquivo.
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
          snippet: clip(snippet, this.maxSnippetChars),
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
      // dedupe por path+line (evita muitas linhas adjacentes equivalentes dominarem top N)
      .filter((hit, idx, arr) => {
        if (idx === 0) return true;
        const prev = arr[idx - 1];
        if (!prev) return true;
        return !(prev.path === hit.path && Math.abs(prev.startLine - hit.startLine) <= 1);
      })
      .slice(0, targetResults);

    for (const result of results.slice(0, 5)) {
      topPathsForLog.push(`${result.path}:${result.startLine}-${result.endLine}`);
    }
    kaelLogger.info("memory.search.finished", {
      query: clip(query, 180),
      baseTerms,
      expandedTerms: terms,
      resultCount: results.length,
      topPaths: topPathsForLog,
    });

    return results;
  }

  async get(params: { relPath: string; from?: number; lines?: number }): Promise<MemoryGetResult> {
    const relPath = normalizeRelPath(params.relPath);
    const absolutePath = this.resolveAllowedMemoryPath(relPath);
    const raw = await fs.readFile(absolutePath, "utf-8");
    const allLines = raw.split("\n");
    const startLine = Math.max(1, Math.floor(params.from ?? 1));
    const lineCount = Math.max(1, Math.floor(params.lines ?? allLines.length));
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = Math.min(allLines.length, startIdx + lineCount);
    const text = allLines.slice(startIdx, endIdx).join("\n");

    return {
      path: this.toRelativeMemoryPath(absolutePath),
      text,
      startLine,
      endLine: Math.max(startLine, startIdx + text.split("\n").length - 1),
    };
  }

  private async listMemoryFiles(): Promise<string[]> {
    const files: string[] = [];
    const seenAliases = new Set<string>();
    const tryAdd = async (filePath: string) => {
      try {
        await fs.access(filePath);
      } catch {
        return;
      }
      const alias = this.toRelativeMemoryPath(filePath);
      if (seenAliases.has(alias)) {
        return;
      }
      seenAliases.add(alias);
      files.push(filePath);
    };
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (entry.isFile() && isMarkdownFile(full)) {
          const alias = this.toRelativeMemoryPath(full);
          if (seenAliases.has(alias)) {
            continue;
          }
          seenAliases.add(alias);
          files.push(full);
        }
      }
    };
    await tryAdd(this.longTermPath);
    await walk(this.dailyDir);
    // Compatibilidade de leitura com legado no workspace.
    await tryAdd(this.legacyLongTermPath);
    await walk(this.legacyDailyDir);
    return files;
  }

  private async migrateLegacyMemoryIfNeeded(): Promise<void> {
    await this.copyFileIfTargetMissing(this.legacyLongTermPath, this.longTermPath);
    await this.copyDailyTreeIfMissing(this.legacyDailyDir, this.dailyDir);
  }

  private async copyFileIfTargetMissing(source: string, target: string): Promise<void> {
    if (!existsSync(source) || existsSync(target)) {
      return;
    }
    await ensureDir(path.dirname(target));
    await fs.copyFile(source, target);
  }

  private async copyDailyTreeIfMissing(sourceDir: string, targetDir: string): Promise<void> {
    if (!existsSync(sourceDir)) {
      return;
    }
    await ensureDir(targetDir);
    const entries = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        await this.copyDailyTreeIfMissing(sourcePath, targetPath);
        continue;
      }
      if (!entry.isFile() || !isMarkdownFile(entry.name)) {
        continue;
      }
      if (existsSync(targetPath)) {
        continue;
      }
      await ensureDir(path.dirname(targetPath));
      await fs.copyFile(sourcePath, targetPath);
    }
  }

  private resolveAllowedMemoryPath(relPath: string): string {
    const normalized = normalizeRelPath(relPath);
    const isLongTerm = normalized === "MEMORY.md";
    const isDaily = normalized.startsWith("memory/") && isMarkdownFile(normalized);
    if (!isLongTerm && !isDaily) {
      throw new Error("memory_get only allows MEMORY.md or memory/*.md paths");
    }
    if (normalized === "MEMORY.md") {
      return this.pickExistingOrPrimary(this.longTermPath, this.legacyLongTermPath);
    }
    const dailyName = normalized.slice("memory/".length);
    return this.pickExistingOrPrimary(path.join(this.dailyDir, dailyName), path.join(this.legacyDailyDir, dailyName));
  }

  private toRelativeMemoryPath(absolutePath: string): string {
    const normalized = path.resolve(absolutePath);
    if (normalized === path.resolve(this.longTermPath) || normalized === path.resolve(this.legacyLongTermPath)) {
      return "MEMORY.md";
    }
    const dailyCurrent = path.resolve(this.dailyDir);
    const dailyLegacy = path.resolve(this.legacyDailyDir);
    if (normalized.startsWith(`${dailyCurrent}${path.sep}`)) {
      return `memory/${normalizeRelPath(path.relative(dailyCurrent, normalized))}`;
    }
    if (normalized.startsWith(`${dailyLegacy}${path.sep}`)) {
      return `memory/${normalizeRelPath(path.relative(dailyLegacy, normalized))}`;
    }
    return normalizeRelPath(path.relative(this.workspaceRoot, absolutePath));
  }

  private pickExistingOrPrimary(primary: string, fallback: string): string {
    // Prefer novo storage; se nao existir ainda, aceita legado para leitura.
    if (existsSync(primary)) {
      return primary;
    }
    if (existsSync(fallback)) {
      return fallback;
    }
    return primary;
  }
}
