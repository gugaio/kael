import fs from "node:fs/promises";
import path from "node:path";

type WorkspaceInspectorConfig = {
  workspaceRoot: string;
  maxFileChars?: number;
  maxSearchResults?: number;
};

export type WorkspaceSearchHit = {
  path: string;
  line: number;
  snippet: string;
};

export class WorkspaceInspector {
  private readonly workspaceRoot: string;
  private readonly maxFileChars: number;
  private readonly maxSearchResults: number;

  constructor(cfg: WorkspaceInspectorConfig) {
    this.workspaceRoot = path.resolve(cfg.workspaceRoot);
    this.maxFileChars = Math.max(2_000, Math.floor(cfg.maxFileChars ?? 80_000));
    this.maxSearchResults = Math.max(1, Math.floor(cfg.maxSearchResults ?? 12));
  }

  async search(params: { query: string; maxResults?: number }): Promise<WorkspaceSearchHit[]> {
    const query = params.query.trim().toLowerCase();
    if (!query) {
      return [];
    }
    const maxResults = Math.max(1, Math.floor(params.maxResults ?? this.maxSearchResults));
    const files = await this.listFiles(this.workspaceRoot);
    const hits: WorkspaceSearchHit[] = [];

    for (const file of files) {
      const rel = this.toRel(file);
      if (this.shouldSkip(rel)) {
        continue;
      }
      const raw = await fs.readFile(file, "utf-8").catch(() => "");
      if (!raw.trim()) {
        continue;
      }
      const content = raw.length > this.maxFileChars ? raw.slice(0, this.maxFileChars) : raw;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].toLowerCase().includes(query)) {
          continue;
        }
        hits.push({
          path: rel,
          line: i + 1,
          snippet: lines[i].trim().slice(0, 240),
        });
        if (hits.length >= maxResults) {
          return hits;
        }
      }
    }

    return hits;
  }

  async read(params: { relPath: string; from?: number; lines?: number }): Promise<{
    path: string;
    text: string;
    startLine: number;
    endLine: number;
  }> {
    const relPath = this.normalizeRelPath(params.relPath);
    const absolute = this.resolveInsideWorkspace(relPath);
    const raw = await fs.readFile(absolute, "utf-8");
    const allLines = raw.split("\n");
    const startLine = Math.max(1, Math.floor(params.from ?? 1));
    const lineCount = Math.max(1, Math.floor(params.lines ?? 160));
    const start = startLine - 1;
    const endExclusive = Math.min(allLines.length, start + lineCount);
    const text = allLines.slice(start, endExclusive).join("\n");
    return {
      path: relPath,
      text,
      startLine,
      endLine: Math.max(startLine, start + Math.max(1, text.split("\n").length) - 1),
    };
  }

  private normalizeRelPath(input: string): string {
    const next = input.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
    if (!next) {
      throw new Error("path is required");
    }
    return next;
  }

  private resolveInsideWorkspace(relPath: string): string {
    const absolute = path.resolve(this.workspaceRoot, relPath);
    if (absolute !== this.workspaceRoot && !absolute.startsWith(`${this.workspaceRoot}${path.sep}`)) {
      throw new Error("path outside workspace");
    }
    return absolute;
  }

  private toRel(absolute: string): string {
    return path.relative(this.workspaceRoot, absolute).replace(/\\/g, "/");
  }

  private shouldSkip(relPath: string): boolean {
    return (
      relPath.startsWith(".git/") ||
      relPath.startsWith("node_modules/") ||
      relPath.startsWith("ui/node_modules/") ||
      relPath.startsWith("dist/") ||
      relPath.startsWith("ui/dist/") ||
      relPath.startsWith(".kael-data/")
    );
  }

  private async listFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const rel = this.toRel(full);
        if (this.shouldSkip(`${rel}/`)) {
          continue;
        }
        files.push(...(await this.listFiles(full)));
        continue;
      }
      if (entry.isFile()) {
        files.push(full);
      }
    }
    return files;
  }
}

