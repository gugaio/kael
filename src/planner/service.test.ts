import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PlannerService, type PlanStepDraftInput } from "./service.js";

async function makePlanner(options?: {
  generateDrafts?: (params: { sessionKey: string; objective: string; maxSteps?: number }) => Promise<PlanStepDraftInput[]>;
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-planner-"));
  const planner = new PlannerService(root, {
    generateDrafts: options?.generateDrafts,
  });
  await planner.init();
  return { planner, root };
}

function fakeDraftsFromObjective(objectiveRaw: string): PlanStepDraftInput[] {
  const objective = objectiveRaw.toLowerCase();
  if (objective.includes("capturar") || objective.includes("transcod") || objective.includes("hls")) {
    return [
      { title: "captura", action: { kind: "capture" } },
      { title: "transcode", action: { kind: "transcode" } },
      { title: "hls", action: { kind: "hls" } },
    ];
  }
  if (objective.includes("ls")) {
    return [
      { title: "Executar comando shell: ls -la", action: { kind: "exec", params: { command: "ls -la" } } },
      {
        title: "Executar comando shell: cat package.json",
        action: { kind: "exec", params: { command: "cat package.json" } },
      },
    ];
  }
  if (objective.includes("teste-hora.txt")) {
    return [
      { title: "Executar comando shell: date", action: { kind: "exec", params: { command: "date" } } },
      {
        title: "Executar comando shell: date > teste-hora.txt",
        action: { kind: "exec", params: { command: "date > teste-hora.txt" } },
      },
    ];
  }
  if (objective.includes("teste.txt") && objective.includes("/tmp")) {
    return [
      {
        title: "Executar comando shell: date > /tmp/teste.txt",
        action: { kind: "exec", params: { command: "date > /tmp/teste.txt" } },
      },
    ];
  }
  if (objective.includes("teste-time-v2.txt") && objective.includes("/tmp")) {
    return [
      {
        title: "Executar comando shell: date > /tmp/teste-time-v2.txt",
        action: { kind: "exec", params: { command: "date > /tmp/teste-time-v2.txt" } },
      },
    ];
  }
  return [{ title: "Executar comando shell: pwd", action: { kind: "exec", params: { command: "pwd" } } }];
}

describe("PlannerService", () => {
  it("creates and lists plans by session", async () => {
    const { planner } = await makePlanner();
    await planner.create({
      sessionKey: "s1",
      title: "Plano A",
      steps: ["step 1", "step 2"],
    });
    await planner.create({
      sessionKey: "s2",
      title: "Plano B",
      steps: ["step x"],
    });

    const onlyS1 = planner.list({ sessionKey: "s1" });
    expect(onlyS1).toHaveLength(1);
    expect(onlyS1[0].title).toBe("Plano A");
  });

  it("updates step status and derives plan status", async () => {
    const { planner } = await makePlanner();
    const plan = await planner.create({
      sessionKey: "s1",
      title: "Executar release",
      steps: ["build", "test"],
    });

    const p1 = await planner.updateStep({
      planId: plan.id,
      stepIndex: 0,
      status: "completed",
    });
    expect(p1?.status).toBe("active");

    const p2 = await planner.updateStep({
      planId: plan.id,
      stepIndex: 1,
      status: "completed",
    });
    expect(p2?.status).toBe("completed");
    expect(p2?.steps[1].checkpoints.length).toBeGreaterThanOrEqual(2);
  });

  it("returns next action from pending/in_progress steps", async () => {
    const { planner } = await makePlanner();
    const plan = await planner.create({
      sessionKey: "s1",
      title: "Plano de deploy",
      steps: ["step 1", "step 2"],
    });
    await planner.updateStep({
      planId: plan.id,
      stepIndex: 0,
      status: "in_progress",
    });

    const next = planner.nextAction(plan.id);
    expect(next).not.toBeNull();
    expect(next?.stepIndex).toBe(0);
    expect(next?.step.status).toBe("in_progress");
  });

  it("marks plan as canceled when all steps are canceled", async () => {
    const { planner } = await makePlanner();
    const plan = await planner.create({
      sessionKey: "s1",
      title: "Cancelar tudo",
      steps: ["a", "b"],
    });

    await planner.updateStep({
      planId: plan.id,
      stepIndex: 0,
      status: "canceled",
    });
    const updated = await planner.updateStep({
      planId: plan.id,
      stepIndex: 1,
      status: "canceled",
    });
    expect(updated?.status).toBe("canceled");
  });

  it("generates plan from objective with derived steps", async () => {
    const { planner } = await makePlanner({
      generateDrafts: async ({ objective }) => fakeDraftsFromObjective(objective),
    });
    const plan = await planner.generate({
      sessionKey: "s1",
      objective: "capturar stream, transcodar para mp4 e gerar hls agendado",
      maxSteps: 10,
    });

    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    expect(plan.title.toLowerCase()).toContain("capturar stream");
    expect(plan.steps.some((step) => step.action.kind === "capture")).toBe(true);
    expect(plan.steps.some((step) => step.action.kind === "transcode")).toBe(true);
    expect(plan.steps.some((step) => step.action.kind === "hls")).toBe(true);
  });

  it("executes next step and links runtime execution id", async () => {
    const { planner } = await makePlanner();
    const plan = await planner.create({
      sessionKey: "s1",
      title: "Pipeline",
      steps: ["Executar transcode com preset seguro e monitorar logs"],
    });

    const result = await planner.executeNext({
      planId: plan.id,
      inputs: {
        inputPath: "/tmp/in.mp4",
        outputPath: "/tmp/out.mp4",
      },
      runtime: {
        startTranscode: async () => ({ id: "job-123", status: "queued" }),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.action).toBe("transcode");
    expect(result.execution?.refId).toBe("job-123");
    expect(result.plan.steps[0].status).toBe("in_progress");
    expect(result.plan.steps[0].execution?.refId).toBe("job-123");
  });

  it("blocks next step when required input is missing", async () => {
    const { planner } = await makePlanner();
    const plan = await planner.create({
      sessionKey: "s1",
      title: "Pipeline",
      steps: ["Gerar HLS (playlist + segmentos) e validar reproducao"],
    });

    const result = await planner.executeNext({
      planId: plan.id,
      inputs: {
        inputPath: "/tmp/in.mp4",
      },
      runtime: {
        startConvertHls: async () => ({ id: "job-hls", status: "queued" }),
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected blocked result");
    }
    expect(result.reason).toBe("missing_input");
    expect(result.plan?.steps[0].status).toBe("blocked");
  });

  it("reconciles in_progress job step to completed", async () => {
    const { planner } = await makePlanner();
    const plan = await planner.create({
      sessionKey: "s1",
      title: "Pipeline",
      steps: ["Executar transcode com preset seguro e monitorar logs"],
    });
    await planner.executeNext({
      planId: plan.id,
      inputs: {
        inputPath: "/tmp/in.mp4",
        outputPath: "/tmp/out.mp4",
      },
      runtime: {
        startTranscode: async () => ({ id: "job-123", status: "running" }),
      },
    });

    const rec = await planner.reconcile({
      runtime: {
        getJob: async (jobId: string) => (jobId === "job-123" ? { status: "succeeded" } : null),
      },
    });
    expect(rec.updatedSteps).toBe(1);
    const updated = planner.get(plan.id);
    expect(updated?.steps[0].status).toBe("completed");
  });

  it("reconciles in_progress exec step to failed", async () => {
    const { planner } = await makePlanner();
    const plan = await planner.create({
      sessionKey: "s1",
      title: "Shell",
      steps: ["Executar comando shell: false"],
    });
    await planner.executeNext({
      planId: plan.id,
      inputs: {
        command: "false",
      },
      runtime: {
        execCommand: async () => ({ id: "exec-1", status: "running", command: "false", cwd: "." }),
      },
    });

    const rec = await planner.reconcile({
      runtime: {
        pollExec: async (sessionId: string) =>
          sessionId === "exec-1" ? { status: "failed", message: "exit 1" } : null,
      },
    });
    expect(rec.updatedSteps).toBe(1);
    const updated = planner.get(plan.id);
    expect(updated?.steps[0].status).toBe("failed");
  });

  it("cancels whole plan and marks all steps as canceled", async () => {
    const { planner } = await makePlanner();
    const plan = await planner.create({
      sessionKey: "s1",
      title: "Cancelar plano",
      steps: ["a", "b", "c"],
    });
    await planner.updateStep({
      planId: plan.id,
      stepIndex: 0,
      status: "completed",
    });

    const canceled = await planner.cancelPlan({
      planId: plan.id,
      note: "cancelado no UI",
    });
    expect(canceled?.status).toBe("canceled");
    expect(canceled?.steps.every((step) => step.status === "canceled")).toBe(true);
  });

  it("generates explicit shell steps from shell objective", async () => {
    const { planner } = await makePlanner({
      generateDrafts: async ({ objective }) => fakeDraftsFromObjective(objective),
    });
    const plan = await planner.generate({
      sessionKey: "s1",
      objective:
        "faz um ls no diretorio atual do projeto e depois um cat se existir um arquivo chamado package.json",
      maxSteps: 8,
    });

    expect(plan.steps.some((step) => step.title.toLowerCase().includes("executar comando shell: ls"))).toBe(true);
    expect(plan.steps.some((step) => step.title.toLowerCase().includes("executar comando shell: cat"))).toBe(true);
    expect(plan.steps.every((step) => step.action.kind === "exec")).toBe(true);
  });

  it("executes shell step without explicit command input when command is in step title", async () => {
    const { planner } = await makePlanner();
    const plan = await planner.create({
      sessionKey: "s1",
      title: "Shell plan",
      steps: ["Executar comando shell: ls -la"],
    });

    const result = await planner.executeNext({
      planId: plan.id,
      runtime: {
        execCommand: async ({ command }) => ({ id: "exec-123", status: command, command, cwd: "." }),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.action).toBe("exec");
    expect(result.plan.steps[0].action.kind).toBe("exec");
    expect(result.execution?.status).toBe("ls -la");
  });

  it("auto-exports shell vars referenced by inline python os.environ.get", async () => {
    const { planner } = await makePlanner();
    const command =
      "MANIFEST_URL='https://example.com/a.m3u8'\n" +
      "FIRST_REF='seg-1.ts'\n" +
      "python3 - <<'PY'\n" +
      "import os\n" +
      "print(os.environ.get('MANIFEST_URL'))\n" +
      "print(os.environ.get('FIRST_REF'))\n" +
      "PY";
    const plan = await planner.create({
      sessionKey: "s1",
      title: "Shell env export",
      steps: ["Executar comando shell: true"],
    });

    let observedCommand = "";
    const result = await planner.executeNext({
      planId: plan.id,
      inputs: { command },
      runtime: {
        execCommand: async ({ command: cmd }) => {
          observedCommand = cmd;
          return { id: "exec-123", status: "running", command: cmd, cwd: "." };
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(observedCommand.startsWith("export MANIFEST_URL\nexport FIRST_REF\n")).toBe(true);
    expect(observedCommand).toContain("os.environ.get('MANIFEST_URL')");
  });

  it("blocks generic step with missing command input", async () => {
    const { planner } = await makePlanner();
    const plan = await planner.create({
      sessionKey: "s1",
      title: "Generico",
      steps: ["Fazer verificacao geral"],
    });

    const result = await planner.executeNext({
      planId: plan.id,
      runtime: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected blocked step");
    }
    expect(result.reason).toBe("missing_input");
    expect(result.action).toBe("exec");
    expect(result.message).toContain("command");
    expect(result.plan?.steps[0].status).toBe("blocked");
  });

  it("extracts date/file commands for time-and-write objective", async () => {
    const { planner } = await makePlanner({
      generateDrafts: async ({ objective }) => fakeDraftsFromObjective(objective),
    });
    const plan = await planner.generate({
      sessionKey: "s1",
      objective: "olha que horas e depois criar um arquivo teste-hora.txt com a hora atual",
    });

    const titles = plan.steps.map((step) => step.title.toLowerCase());
    expect(titles.some((t) => t.includes("executar comando shell: date"))).toBe(true);
    expect(titles.some((t) => t.includes("executar comando shell: date > teste-hora.txt"))).toBe(true);
  });

  it("uses /tmp path when objective asks file in /tmp", async () => {
    const { planner } = await makePlanner({
      generateDrafts: async ({ objective }) => fakeDraftsFromObjective(objective),
    });
    const plan = await planner.generate({
      sessionKey: "s1",
      objective: "olha a hora e cria teste.txt em /tmp/",
    });
    const titles = plan.steps.map((step) => step.title.toLowerCase());
    expect(titles.some((t) => t.includes("executar comando shell: date > /tmp/teste.txt"))).toBe(true);
  });

  it("uses /tmp path when objective says em /tmp and explicit filename", async () => {
    const { planner } = await makePlanner({
      generateDrafts: async ({ objective }) => fakeDraftsFromObjective(objective),
    });
    const plan = await planner.generate({
      sessionKey: "s1",
      objective:
        "olha a hora da maquina e gera um txt em /tmp informando a hora do teste, e gera com o nome teste-time-v2.txt",
    });
    const titles = plan.steps.map((step) => step.title.toLowerCase());
    expect(titles.some((t) => t.includes("executar comando shell: date > /tmp/teste-time-v2.txt"))).toBe(true);
  });
});
