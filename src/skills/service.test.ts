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
    const skills = new SkillService(root, undefined, { autoSkillMinScore: 2 });

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
    const skills = new SkillService(root, undefined, { autoSkillMinScore: 2 });

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
    const skills = new SkillService(root, undefined, { autoSkillMinScore: 2, autoSkillMaxPerTurn: 1 });

    const result = await skills.resolveManualInvocation("/jobs");
    expect(result).toEqual({ matched: false });
    const telemetry = skills.getRuntimeTelemetrySnapshot();
    expect(telemetry.manualInvocations).toBe(0);
  });

  it("injeta catalogo e aplica auto skill quando relevante", async () => {
    const root = await createWorkspace();
    await writeSkill(
      root,
      "review-pr",
      `---
name: review-pr
description: Revisa pull requests e aponta riscos de regressao
---
Sempre listar riscos por severidade com referencia de arquivo.`,
    );
    await writeSkill(
      root,
      "release-notes",
      `---
name: release-notes
description: Gera changelog de release
---
Gere notas curtas de release.`,
    );
    const skills = new SkillService(root, undefined, { autoSkillMinScore: 2, autoSkillMaxPerTurn: 1 });

    const result = await skills.prepareTurnMessage("pode revisar esse pull request focando regressao?");
    expect(result.autoAppliedSkillName).toBe("review-pr");
    expect(result.promptMessage).toContain("[available_skills]");
    expect(result.promptMessage).toContain("name: review-pr");
    expect(result.promptMessage).toContain("[auto_skill_selected]");
    expect(result.promptMessage).toContain("[skill_instructions]");
    const telemetry = skills.getRuntimeTelemetrySnapshot();
    expect(telemetry.autoInvocations).toBe(1);
  });

  it("nao auto-invoca skill com disable-model-invocation=true", async () => {
    const root = await createWorkspace();
    await writeSkill(
      root,
      "deploy",
      `---
name: deploy
description: Faz deploy em producao
disable-model-invocation: true
---
Passos de deploy.`,
    );
    const skills = new SkillService(root, undefined, { autoSkillMinScore: 2, autoSkillMaxPerTurn: 1 });

    const result = await skills.prepareTurnMessage("faz deploy da aplicacao");
    expect(result.autoAppliedSkillName).toBe(null);
    expect(result.promptMessage).toBe("faz deploy da aplicacao");
    expect(result.promptMessage).not.toContain("[auto_skill_selected]");
    expect(result.promptMessage).not.toContain("name: deploy");
    const telemetry = skills.getRuntimeTelemetrySnapshot();
    expect(telemetry.autoInvocations).toBe(0);
  });

  it("parseia frontmatter multiline e argumentos com aspas/colon", async () => {
    const root = await createWorkspace();
    await writeSkill(
      root,
      "docs-assistant",
      `---
name: docs-assistant
description: >
  Ajuda com documentacao tecnica
  com foco em exemplos praticos.
argument-hint: "[arquivo] [formato: curto|longo]"
---
Explique o arquivo $0 no formato $1.`,
    );
    const skills = new SkillService(root, undefined, { autoSkillMinScore: 2, autoSkillMaxPerTurn: 1 });

    const prepared = await skills.prepareTurnMessage("preciso de ajuda com documentacao tecnica");
    expect(prepared.promptMessage).toContain("name: docs-assistant");
    expect(prepared.promptMessage).toContain("description: Ajuda com documentacao tecnica com foco em exemplos praticos.");
    expect(prepared.promptMessage).toContain("argumentHint: [arquivo] [formato: curto|longo]");

    const manual = await skills.resolveManualInvocation("/docs-assistant README.md longo");
    expect(manual.matched).toBe(true);
    if (!manual.matched || manual.blocked) {
      throw new Error("resultado inesperado");
    }
    expect(manual.promptMessage).toContain("Explique o arquivo README.md no formato longo.");
  });

  it("parseia listas no frontmatter sem quebrar a carga da skill", async () => {
    const root = await createWorkspace();
    await writeSkill(
      root,
      "api-conventions",
      `---
name: api-conventions
description:
  - Padroes de API REST
  - Erros consistentes
tags:
  - api
  - backend
---
Use os padroes ao revisar endpoints.`,
    );
    const skills = new SkillService(root, undefined, { autoSkillMinScore: 2, autoSkillMaxPerTurn: 1 });

    const result = await skills.prepareTurnMessage("quais sao os padroes de api rest?");
    expect(result.autoAppliedSkillName).toBe("api-conventions");
    expect(result.promptMessage).toContain("description: Padroes de API REST Erros consistentes");
  });

  it("respeita threshold configuravel de auto skill", async () => {
    const root = await createWorkspace();
    await writeSkill(
      root,
      "review-pr",
      `---
name: review-pr
description: Revisa pull requests
---
Liste riscos por severidade.`,
    );
    const skills = new SkillService(root, undefined, { autoSkillMinScore: 99 });

    const result = await skills.prepareTurnMessage("pode revisar esse pull request?");
    expect(result.autoAppliedSkillName).toBe(null);
    expect(result.promptMessage).toContain("[available_skills]");
    expect(result.promptMessage).not.toContain("[auto_skill_selected]");
  });

  it("respeita budget configuravel do catalogo", async () => {
    const root = await createWorkspace();
    await writeSkill(
      root,
      "a-first",
      `---
name: a-first
description: Skill A para fluxo grande de revisao tecnica com muito texto adicional.
---
Instrucao A`,
    );
    await writeSkill(
      root,
      "b-second",
      `---
name: b-second
description: Skill B para fluxo grande de revisao tecnica com muito texto adicional.
---
Instrucao B`,
    );
    const skills = new SkillService(root, undefined, { catalogMaxChars: 220 });

    const result = await skills.prepareTurnMessage("quero revisar codigo");
    expect(result.promptMessage).toContain("name: a-first");
    expect(result.promptMessage).not.toContain("name: b-second");
  });

  it("permite desativar auto invocacao por configuracao", async () => {
    const root = await createWorkspace();
    await writeSkill(
      root,
      "review-pr",
      `---
name: review-pr
description: Revisa pull requests e regressao
---
Liste riscos por severidade.`,
    );
    const skills = new SkillService(root, undefined, { autoSkillMaxPerTurn: 0 });

    const result = await skills.prepareTurnMessage("revisa esse pull request focando regressao");
    expect(result.autoAppliedSkillName).toBe(null);
    expect(result.promptMessage).toContain("[available_skills]");
    expect(result.promptMessage).not.toContain("[auto_skill_selected]");
  });
});
