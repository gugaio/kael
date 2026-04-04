import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";

export type KnowledgeNoteStatus = "draft" | "curated" | "stale" | "conflicting";
export type KnowledgeNoteKind = "fact" | "analysis" | "decision";

export type KnowledgeNote = {
  id: string;
  project: string;
  topic: string;
  kind: KnowledgeNoteKind;
  title: string;
  question?: string;
  answer: string;
  summary?: string;
  tags: string[];
  files: string[];
  evidence: string[];
  status: KnowledgeNoteStatus;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  source?: string;
};

export type KnowledgeSearchResult = {
  id: string;
  project: string;
  topic: string;
  kind: KnowledgeNoteKind;
  title: string;
  status: KnowledgeNoteStatus;
  confidence: number;
  updatedAt: string;
  score: number;
  snippet: string;
};

export type KnowledgeUpsertInput = {
  noteId?: string;
  project: string;
  topic: string;
  kind?: KnowledgeNoteKind;
  title?: string;
  question?: string;
  answer: string;
  summary?: string;
  tags?: string[];
  files?: string[];
  evidence?: string[];
  status?: KnowledgeNoteStatus;
  confidence?: number;
  updatedBy?: string;
  source?: string;
};

type KnowledgeIndexRecord = {
  id: string;
  project: string;
  topic: string;
  kind: KnowledgeNoteKind;
  title: string;
  summary?: string;
  tags: string[];
  files: string[];
  evidence: string[];
  status: KnowledgeNoteStatus;
  confidence: number;
  updatedAt: string;
};

type KnowledgeServiceConfig = {
  rootDir: string;
  maxSnippetChars?: number;
};

function slugify(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "item";
}

function uniqStrings(values: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (trimmed) {
      out.add(trimmed);
    }
  }
  return [...out];
}

function clampConfidence(input: number | undefined): number {
  if (!Number.isFinite(input)) {
    return 0.7;
  }
  return Math.min(1, Math.max(0, input ?? 0.7));
}

function buildSnippet(note: KnowledgeNote, queryTokens: string[], maxChars: number): string {
  const haystack = [note.summary, note.question, note.answer, ...note.evidence, ...note.files].filter(Boolean).join("\n");
  if (!haystack.trim()) {
    return "";
  }
  const lowered = haystack.toLowerCase();
  const firstToken = queryTokens.find((token) => lowered.includes(token));
  if (!firstToken) {
    return haystack.slice(0, maxChars).trim();
  }
  const index = lowered.indexOf(firstToken);
  const start = Math.max(0, index - Math.floor(maxChars / 3));
  const end = Math.min(haystack.length, start + maxChars);
  return haystack.slice(start, end).trim();
}

function scoreNote(note: KnowledgeNote, queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 0;
  }
  const fields = [
    note.project,
    note.topic,
    note.title,
    note.summary ?? "",
    note.question ?? "",
    note.answer,
    note.tags.join(" "),
    note.files.join(" "),
    note.evidence.join(" "),
  ].map((value) => value.toLowerCase());

  let score = 0;
  for (const token of queryTokens) {
    if (fields[0]?.includes(token)) score += 6;
    if (fields[1]?.includes(token)) score += 5;
    if (fields[2]?.includes(token)) score += 5;
    if (fields[3]?.includes(token)) score += 4;
    if (fields[4]?.includes(token)) score += 3;
    if (fields[5]?.includes(token)) score += 3;
    if (fields[6]?.includes(token)) score += 2;
    if (fields[7]?.includes(token)) score += 2;
    if (fields[8]?.includes(token)) score += 1;
  }
  score += Math.round(note.confidence * 10);
  return score;
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function renderMarkdown(note: KnowledgeNote): string {
  const lines = [
    `# ${note.title}`,
    "",
    `- id: ${note.id}`,
    `- project: ${note.project}`,
    `- topic: ${note.topic}`,
    `- kind: ${note.kind}`,
    `- status: ${note.status}`,
    `- confidence: ${note.confidence}`,
    `- createdAt: ${note.createdAt}`,
    `- updatedAt: ${note.updatedAt}`,
    ...(note.updatedBy ? [`- updatedBy: ${note.updatedBy}`] : []),
    ...(note.source ? [`- source: ${note.source}`] : []),
    ...(note.tags.length > 0 ? [`- tags: ${note.tags.join(", ")}`] : []),
    "",
    "## Answer",
    note.answer,
    ...(note.summary ? ["", "## Summary", note.summary] : []),
    ...(note.question ? ["", "## Question", note.question] : []),
    ...(note.files.length > 0 ? ["", "## Files", ...note.files.map((item) => `- ${item}`)] : []),
    ...(note.evidence.length > 0 ? ["", "## Evidence", ...note.evidence.map((item) => `- ${item}`)] : []),
  ];
  return lines.join("\n").trimEnd() + "\n";
}

export class KnowledgeService {
  private readonly rootDir: string;
  private readonly notesDir: string;
  private readonly indexPath: string;
  private readonly maxSnippetChars: number;

  constructor(cfg: KnowledgeServiceConfig) {
    this.rootDir = path.resolve(cfg.rootDir);
    this.notesDir = path.join(this.rootDir, "notes");
    this.indexPath = path.join(this.rootDir, "index.json");
    this.maxSnippetChars = Math.max(200, Math.floor(cfg.maxSnippetChars ?? 500));
  }

  async init(): Promise<void> {
    await ensureDir(this.rootDir);
    await ensureDir(this.notesDir);
    const existing = await readJsonFile<KnowledgeIndexRecord[]>(this.indexPath, []);
    if (!Array.isArray(existing)) {
      await writeJsonFile(this.indexPath, []);
    }
  }

  async upsert(input: KnowledgeUpsertInput): Promise<KnowledgeNote> {
    const project = input.project.trim();
    const topic = input.topic.trim();
    const answer = input.answer.trim();
    if (!project) throw new Error("project is required");
    if (!topic) throw new Error("topic is required");
    if (!answer) throw new Error("answer is required");

    const now = new Date().toISOString();
    const noteId = input.noteId?.trim() || `${slugify(project)}--${slugify(topic)}`;
    const existing = await this.get(noteId);
    const note: KnowledgeNote = {
      id: noteId,
      project,
      topic,
      kind: input.kind ?? existing?.kind ?? "analysis",
      title: input.title?.trim() || existing?.title || topic,
      question: input.question?.trim() || existing?.question,
      answer,
      summary: input.summary?.trim() || existing?.summary,
      tags: uniqStrings([...(existing?.tags ?? []), ...(input.tags ?? [])]),
      files: uniqStrings([...(existing?.files ?? []), ...(input.files ?? [])]),
      evidence: uniqStrings([...(existing?.evidence ?? []), ...(input.evidence ?? [])]),
      status: input.status ?? existing?.status ?? "draft",
      confidence: clampConfidence(input.confidence ?? existing?.confidence),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: input.updatedBy?.trim() || existing?.updatedBy,
      source: input.source?.trim() || existing?.source,
    };

    const noteDir = path.join(this.notesDir, slugify(project));
    const jsonPath = path.join(noteDir, `${noteId}.json`);
    const mdPath = path.join(noteDir, `${noteId}.md`);
    await ensureDir(noteDir);
    await writeJsonFile(jsonPath, note);
    await fs.writeFile(mdPath, renderMarkdown(note), "utf-8");

    const index = await readJsonFile<KnowledgeIndexRecord[]>(this.indexPath, []);
    const nextRecord: KnowledgeIndexRecord = {
      id: note.id,
      project: note.project,
      topic: note.topic,
      kind: note.kind,
      title: note.title,
      summary: note.summary,
      tags: note.tags,
      files: note.files,
      evidence: note.evidence,
      status: note.status,
      confidence: note.confidence,
      updatedAt: note.updatedAt,
    };
    const nextIndex = index.filter((item) => item.id !== note.id);
    nextIndex.push(nextRecord);
    nextIndex.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    await writeJsonFile(this.indexPath, nextIndex);
    return note;
  }

  async get(noteId: string): Promise<KnowledgeNote | null> {
    const index = await readJsonFile<KnowledgeIndexRecord[]>(this.indexPath, []);
    const match = index.find((item) => item.id === noteId);
    if (!match) {
      return null;
    }
    const jsonPath = path.join(this.notesDir, slugify(match.project), `${noteId}.json`);
    const note = await readJsonFile<KnowledgeNote | null>(jsonPath, null);
    return note;
  }

  async search(params: {
    query: string;
    project?: string;
    tag?: string;
    status?: KnowledgeNoteStatus;
    kind?: KnowledgeNoteKind;
    maxResults?: number;
  }): Promise<KnowledgeSearchResult[]> {
    const query = params.query.trim();
    if (!query) {
      return [];
    }
    const tokens = tokenizeQuery(query);
    const index = await readJsonFile<KnowledgeIndexRecord[]>(this.indexPath, []);
    const maxResults = Math.max(1, Math.floor(params.maxResults ?? 6));
    const candidates: KnowledgeSearchResult[] = [];

    for (const item of index) {
      if (params.project && item.project !== params.project) continue;
      if (params.kind && item.kind !== params.kind) continue;
      if (params.tag && !item.tags.includes(params.tag)) continue;
      if (params.status && item.status !== params.status) continue;
      const note = await this.get(item.id);
      if (!note) continue;
      const score = scoreNote(note, tokens);
      if (score <= 0) continue;
      candidates.push({
        id: note.id,
        project: note.project,
        topic: note.topic,
        kind: note.kind,
        title: note.title,
        status: note.status,
        confidence: note.confidence,
        updatedAt: note.updatedAt,
        score,
        snippet: buildSnippet(note, tokens, this.maxSnippetChars),
      });
    }

    return candidates.sort((left, right) => right.score - left.score).slice(0, maxResults);
  }
}
