import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";

const PROJECTS_RELATIVE_DIR = path.join(".kael", "projects");
const PROJECT_FILE_NAME = "PROJECT.md";
const PROJECT_INDEX_FILE = "index.json";
const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DOC_PATH_RE = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md$/;

export type ProjectDocumentRecord = {
  path: string;
  title: string;
  description: string;
  tags: string[];
  updatedAt: string;
};

export type ProjectIndex = {
  project: string;
  documents: ProjectDocumentRecord[];
};

export type ProjectContext = {
  name: string;
  dirPath: string;
  filePath: string;
  content: string;
  created: boolean;
  index: ProjectIndex;
};

export type ProjectDocument = {
  project: string;
  path: string;
  title: string;
  description: string;
  tags: string[];
  content: string;
  updatedAt: string;
};

export type ProjectSearchResult = {
  project: string;
  path: string;
  title: string;
  description: string;
  tags: string[];
  updatedAt: string;
  score: number;
  snippet: string;
};

function normalizeProjectName(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (!PROJECT_NAME_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeDocPath(raw: string | undefined): string {
  const trimmed = raw?.trim() || PROJECT_FILE_NAME;
  if (!DOC_PATH_RE.test(trimmed) || trimmed.includes("..")) {
    throw new Error("invalid project document path");
  }
  return trimmed;
}

function uniqStrings(values: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (trimmed) out.add(trimmed);
  }
  return [...out];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function buildInitialProjectMarkdown(projectName: string): string {
  return [
    `# ${projectName}`,
    "",
    "## Summary",
    "Preencha um resumo curto deste projeto.",
    "",
    "## Boundaries",
    "- descreva o que este projeto cobre",
    "",
    "## Key Flows",
    "- app entrypoints",
    "- networking",
    "- params/contracts",
    "- playback/video",
    "",
    "## Important Paths",
    "- liste diretorios/arquivos relevantes",
    "",
    "## Conventions",
    "- adicione aqui convencoes importantes",
    "",
    "## Open Questions",
    "- registre lacunas e pontos a validar",
    "",
  ].join("\n");
}

function buildDefaultIndex(projectName: string): ProjectIndex {
  const now = new Date().toISOString();
  return {
    project: projectName,
    documents: [
      {
        path: PROJECT_FILE_NAME,
        title: "Project Overview",
        description: "Visao geral, areas principais, convencoes e mapa do projeto.",
        tags: ["overview"],
        updatedAt: now,
      },
    ],
  };
}

function buildSnippet(content: string, queryTokens: string[], maxChars = 400): string {
  const normalized = content.trim();
  if (!normalized) return "";
  if (queryTokens.length === 0) return normalized.slice(0, maxChars);
  const lowered = normalized.toLowerCase();
  const first = queryTokens.find((token) => lowered.includes(token));
  if (!first) return normalized.slice(0, maxChars);
  const idx = lowered.indexOf(first);
  const start = Math.max(0, idx - Math.floor(maxChars / 3));
  return normalized.slice(start, Math.min(normalized.length, start + maxChars));
}

function compareProjectDocPath(left: string, right: string): number {
  if (left === PROJECT_FILE_NAME && right !== PROJECT_FILE_NAME) return -1;
  if (right === PROJECT_FILE_NAME && left !== PROJECT_FILE_NAME) return 1;
  return left.localeCompare(right);
}

function scoreDocument(doc: ProjectDocument, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const fields = [doc.project, doc.path, doc.title, doc.description, doc.tags.join(" "), doc.content].map((value) =>
    value.toLowerCase(),
  );
  let score = 0;
  for (const token of queryTokens) {
    if (fields[0]?.includes(token)) score += 6;
    if (fields[1]?.includes(token)) score += 4;
    if (fields[2]?.includes(token)) score += 5;
    if (fields[3]?.includes(token)) score += 4;
    if (fields[4]?.includes(token)) score += 2;
    if (fields[5]?.includes(token)) score += 3;
  }
  return score;
}

export function extractProjectMention(message: string): { projectName: string; cleanedMessage: string } | null {
  const match = message.match(/(^|\s)@([a-z0-9][a-z0-9-]{0,63})(?=\s|$)/i);
  const projectName = normalizeProjectName(match?.[2] ?? "");
  if (!projectName || !match?.[0]) {
    return null;
  }
  const cleanedMessage = message.replace(match[0], " ").replace(/\s+/g, " ").trim();
  return { projectName, cleanedMessage };
}

export class ProjectContextService {
  private readonly projectsDir: string;

  constructor(workspaceRoot: string) {
    this.projectsDir = path.join(workspaceRoot, PROJECTS_RELATIVE_DIR);
  }

  async ensureProject(projectNameRaw: string): Promise<ProjectContext> {
    const project = this.requireProjectName(projectNameRaw);
    const dirPath = path.join(this.projectsDir, project);
    const filePath = path.join(dirPath, PROJECT_FILE_NAME);
    const indexPath = path.join(dirPath, PROJECT_INDEX_FILE);
    await ensureDir(dirPath);
    let created = false;

    let content = await fs.readFile(filePath, "utf-8").catch(async () => {
      created = true;
      const initial = buildInitialProjectMarkdown(project);
      await fs.writeFile(filePath, initial, "utf-8");
      return initial;
    });
    if (!content.trim()) {
      created = true;
      content = buildInitialProjectMarkdown(project);
      await fs.writeFile(filePath, content, "utf-8");
    }

    let index = await readJsonFile<ProjectIndex | null>(indexPath, null);
    if (!index || !Array.isArray(index.documents)) {
      index = buildDefaultIndex(project);
      await writeJsonFile(indexPath, index);
    } else if (!index.documents.some((item) => item.path === PROJECT_FILE_NAME)) {
      index.documents.unshift(buildDefaultIndex(project).documents[0]!);
      await writeJsonFile(indexPath, index);
    }

    return { name: project, dirPath, filePath, content, created, index };
  }

  async listDocuments(projectNameRaw: string): Promise<ProjectDocumentRecord[]> {
    const project = await this.ensureProject(projectNameRaw);
    return project.index.documents.slice().sort((a, b) => compareProjectDocPath(a.path, b.path));
  }

  async getDocument(projectNameRaw: string, docPathRaw = PROJECT_FILE_NAME): Promise<ProjectDocument | null> {
    const project = await this.ensureProject(projectNameRaw);
    const docPath = normalizeDocPath(docPathRaw);
    const record = project.index.documents.find((item) => item.path === docPath);
    if (!record) return null;
    const fullPath = path.join(project.dirPath, docPath);
    const content = await fs.readFile(fullPath, "utf-8").catch(() => "");
    return {
      project: project.name,
      path: record.path,
      title: record.title,
      description: record.description,
      tags: record.tags,
      content,
      updatedAt: record.updatedAt,
    };
  }

  async upsertDocument(input: {
    project: string;
    path?: string;
    title?: string;
    description?: string;
    tags?: string[];
    content: string;
    mode?: "replace" | "append";
  }): Promise<ProjectDocument> {
    const project = await this.ensureProject(input.project);
    const docPath = normalizeDocPath(input.path);
    const fullPath = path.join(project.dirPath, docPath);
    await ensureDir(path.dirname(fullPath));

    const existingRecord = project.index.documents.find((item) => item.path === docPath);
    const existingContent = await fs.readFile(fullPath, "utf-8").catch(() => "");
    const nextContent = (input.mode ?? "replace") === "append" && existingContent.trim()
      ? `${existingContent.trimEnd()}\n\n${input.content.trim()}\n`
      : `${input.content.trimEnd()}\n`;
    await fs.writeFile(fullPath, nextContent, "utf-8");

    const now = new Date().toISOString();
    const nextRecord: ProjectDocumentRecord = {
      path: docPath,
      title: input.title?.trim() || existingRecord?.title || this.deriveTitle(docPath),
      description: input.description?.trim() || existingRecord?.description || `Documento ${docPath} do projeto ${project.name}.`,
      tags: uniqStrings([...(existingRecord?.tags ?? []), ...(input.tags ?? [])]),
      updatedAt: now,
    };
    const nextIndex: ProjectIndex = {
      project: project.name,
      documents: project.index.documents.filter((item) => item.path !== docPath).concat(nextRecord),
    };
    nextIndex.documents.sort((a, b) => compareProjectDocPath(a.path, b.path));
    await writeJsonFile(path.join(project.dirPath, PROJECT_INDEX_FILE), nextIndex);

    return {
      project: project.name,
      path: nextRecord.path,
      title: nextRecord.title,
      description: nextRecord.description,
      tags: nextRecord.tags,
      content: nextContent,
      updatedAt: nextRecord.updatedAt,
    };
  }

  async search(params: { query: string; project?: string; maxResults?: number }): Promise<ProjectSearchResult[]> {
    const query = params.query.trim();
    if (!query) return [];
    const queryTokens = tokenize(query);
    const projectNames = params.project
      ? [this.requireProjectName(params.project)]
      : await this.listProjectNames();
    const results: ProjectSearchResult[] = [];

    for (const projectName of projectNames) {
      const project = await this.ensureProject(projectName);
      for (const record of project.index.documents) {
        const doc = await this.getDocument(project.name, record.path);
        if (!doc) continue;
        const score = scoreDocument(doc, queryTokens);
        if (score <= 0) continue;
        results.push({
          project: doc.project,
          path: doc.path,
          title: doc.title,
          description: doc.description,
          tags: doc.tags,
          updatedAt: doc.updatedAt,
          score,
          snippet: buildSnippet(doc.content, queryTokens),
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, Math.max(1, params.maxResults ?? 6));
  }

  private async listProjectNames(): Promise<string[]> {
    await ensureDir(this.projectsDir);
    const entries = await fs.readdir(this.projectsDir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => normalizeProjectName(entry.name))
      .filter((value): value is string => Boolean(value));
  }

  private requireProjectName(raw: string): string {
    const normalized = normalizeProjectName(raw);
    if (!normalized) throw new Error("invalid project name");
    return normalized;
  }

  private deriveTitle(docPath: string): string {
    const base = docPath.replace(/\.md$/i, "").split("/").pop() ?? docPath;
    return base
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
}
