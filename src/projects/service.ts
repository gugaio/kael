import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../infra/fs.js";

const PROJECTS_RELATIVE_DIR = path.join(".kael", "projects");
const PROJECT_FILE_NAME = "PROJECT.md";
const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type ProjectContext = {
  name: string;
  filePath: string;
  content: string;
  created: boolean;
};

function normalizeProjectName(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (!PROJECT_NAME_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

function buildInitialProjectMarkdown(projectName: string): string {
  return [
    `# ${projectName}`,
    "",
    "## Summary",
    "Preencha um resumo curto deste projeto.",
    "",
    "## Key Areas",
    "- app entrypoints",
    "- networking",
    "- params/contracts",
    "- playback/video",
    "",
    "## Conventions",
    "- adicione aqui convencoes importantes",
    "",
    "## Notes",
    "- use a knowledge base para fatos e analises incrementais",
    "",
  ].join("\n");
}

export function extractProjectMention(message: string): { projectName: string; cleanedMessage: string } | null {
  const match = message.match(/(^|\s)@([a-z0-9][a-z0-9-]{0,63})(?=\s|$)/i);
  const projectName = normalizeProjectName(match?.[2] ?? "");
  if (!projectName || !match?.[0]) {
    return null;
  }
  const cleanedMessage = message.replace(match[0], " ").replace(/\s+/g, " ").trim();
  return {
    projectName,
    cleanedMessage,
  };
}

export class ProjectContextService {
  private readonly projectsDir: string;

  constructor(workspaceRoot: string) {
    this.projectsDir = path.join(workspaceRoot, PROJECTS_RELATIVE_DIR);
  }

  async ensureProject(projectNameRaw: string): Promise<ProjectContext> {
    const projectName = normalizeProjectName(projectNameRaw);
    if (!projectName) {
      throw new Error("invalid project name");
    }
    const dir = path.join(this.projectsDir, projectName);
    const filePath = path.join(dir, PROJECT_FILE_NAME);
    await ensureDir(dir);
    let created = false;
    let content = await fs.readFile(filePath, "utf-8").catch(async () => {
      created = true;
      const initial = buildInitialProjectMarkdown(projectName);
      await fs.writeFile(filePath, initial, "utf-8");
      return initial;
    });
    if (!content.trim()) {
      created = true;
      content = buildInitialProjectMarkdown(projectName);
      await fs.writeFile(filePath, content, "utf-8");
    }
    return {
      name: projectName,
      filePath,
      content,
      created,
    };
  }
}
