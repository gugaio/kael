import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureDir } from "../infra/fs.js";

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
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }
    const terms = Array.from(
      new Set(
        normalizedQuery
          .split(/\s+/)
          .map((item) => item.trim())
          .filter((item) => item.length >= 2),
      ),
    );
    if (terms.length === 0) {
      return [];
    }

    const files = await this.listMemoryFiles();
    const targetResults = Number.isFinite(maxResults ?? NaN)
      ? Math.max(1, Math.floor(maxResults ?? this.defaultMaxResults))
      : this.defaultMaxResults;
    const hits: MemorySearchResult[] = [];

    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf-8").catch(() => "");
      if (!content.trim()) {
        continue;
      }
      const lines = content.split("\n");
      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const lower = line.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (lower.includes(term)) {
            score += 1;
          }
        }
        if (score === 0) {
          continue;
        }
        const start = Math.max(0, idx - 1);
        const end = Math.min(lines.length - 1, idx + 1);
        const snippet = lines.slice(start, end + 1).join("\n").trim();
        hits.push({
          path: this.toRelativeMemoryPath(filePath),
          startLine: start + 1,
          endLine: end + 1,
          snippet: clip(snippet, this.maxSnippetChars),
          score,
        });
      }
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, targetResults);
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
