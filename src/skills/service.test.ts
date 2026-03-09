import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillService } from "./service.js";

const createdDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-skills-"));
  createdDirs.push(root);
  return root;
}

async function writeSkill(
  workspaceRoot: string,
  skillDirName: string,
  markdown: string,
): Promise<string> {
  const dir = path.join(workspaceRoot, ".kael", "skills", skillDirName);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  await fs.writeFile(filePath, markdown, "utf-8");
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0, createdDirs.length).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("SkillService", () => {
  it("resolve invocacao manual com substituicao de argumentos", async () => {
    const root = await createWorkspace();
    await writeSkill(
      root,
      "explain-code",
      `---
name: explain-code
description: Explica codigo com diagrama
---
Explique o arquivo $0 e compare com $1.
Contexto completo: $ARGUMENTS`,
    );
    const skills = new SkillService(root);

    const result = await skills.resolveManualInvocation("/explain-code src/app.ts aeroporto");
    expect(result.matched).toBe(true);
    if (!result.matched || result.blocked) {
      throw new Error("resultado inesperado");
    }
    expect(result.skillName).toBe("explain-code");
    expect(result.promptMessage).toContain("Explique o arquivo src/app.ts e compare com aeroporto.");
    expect(result.promptMessage).toContain("Contexto completo: src/app.ts aeroporto");
    const telemetry = skills.getRuntimeTelemetrySnapshot();
    expect(telemetry.skillsDiscovered).toBe(1);
    expect(telemetry.manualInvocations).toBe(1);
  });

  it("bloqueia invocacao manual quando user-invocable=false", async () => {
    const root = await createWorkspace();
    await writeSkill(
      root,
      "internal-guideline",
      `---
name: internal-guideline
description: contexto interno
user-invocable: false
---
Use estas diretrizes apenas automaticamente.`,
    );
    const skills = new SkillService(root);

    const result = await skills.resolveManualInvocation("/internal-guideline");
    expect(result).toEqual({
      matched: true,
      blocked: true,
      skillName: "internal-guideline",
      reply: "A skill /internal-guideline nao pode ser invocada manualmente (user-invocable=false).",
    });
    const telemetry = skills.getRuntimeTelemetrySnapshot();
    expect(telemetry.invocationBlocked).toBe(1);
  });

  it("nao intercepta comandos operacionais reservados", async () => {
    const root = await createWorkspace();
    await writeSkill(
      root,
      "jobs",
      `---
name: jobs
description: deveria perder para comando operacional
---
Liste jobs`,
    );
    const skills = new SkillService(root);

    const result = await skills.resolveManualInvocation("/jobs");
    expect(result).toEqual({ matched: false });
    const telemetry = skills.getRuntimeTelemetrySnapshot();
    expect(telemetry.manualInvocations).toBe(0);
  });
});

