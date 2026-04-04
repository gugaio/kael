import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractProjectMention, ProjectContextService } from "./service.js";

const roots: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-projects-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0, roots.length).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("ProjectContextService", () => {
  it("extracts @project mention and cleaned message", () => {
    expect(extractProjectMention("@ios-app como o parametro x e enviado?")).toEqual({
      projectName: "ios-app",
      cleanedMessage: "como o parametro x e enviado?",
    });
  });

  it("creates scaffold on first ensure", async () => {
    const root = await createWorkspace();
    const service = new ProjectContextService(root);

    const project = await service.ensureProject("ios-app");

    expect(project.name).toBe("ios-app");
    expect(project.created).toBe(true);
    expect(project.content).toContain("# ios-app");
    await expect(fs.readFile(project.filePath, "utf-8")).resolves.toContain("## Summary");
  });
});
