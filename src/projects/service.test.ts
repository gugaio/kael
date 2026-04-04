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
    await expect(fs.readFile(path.join(root, ".kael", "projects", "ios-app", "index.json"), "utf-8")).resolves.toContain(
      "\"PROJECT.md\"",
    );
  });

  it("upserts documents, indexes them and searches by content", async () => {
    const root = await createWorkspace();
    const service = new ProjectContextService(root);

    const doc = await service.upsertDocument({
      project: "ios-app",
      path: "params.md",
      title: "iOS Params",
      description: "Parametros e contratos",
      tags: ["ios", "params"],
      content: "O parametro x e enviado no body de /session/start.",
      allowCreate: true,
    });

    expect(doc.path).toBe("params.md");
    const listed = await service.listDocuments("ios-app");
    expect(listed.map((item) => item.path)).toEqual(["PROJECT.md", "params.md"]);

    const found = await service.getDocument("ios-app", "params.md");
    expect(found?.content).toContain("/session/start");

    const results = await service.search({ query: "como o ios envia parametro x", project: "ios-app" });
    expect(results[0]?.path).toBe("params.md");
  });

  it("blocks creating a new markdown file without explicit allowCreate", async () => {
    const root = await createWorkspace();
    const service = new ProjectContextService(root);

    await expect(
      service.upsertDocument({
        project: "ios-app",
        path: "params.md",
        title: "iOS Params",
        description: "Parametros e contratos",
        content: "novo doc",
      }),
    ).rejects.toThrow("ask for user approval before creating a new markdown file");
  });
});
