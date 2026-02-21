import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PlannerService } from "./service.js";

async function makePlanner() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-planner-"));
  const planner = new PlannerService(root);
  await planner.init();
  return { planner, root };
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
    const { planner } = await makePlanner();
    const plan = await planner.generate({
      sessionKey: "s1",
      objective: "capturar stream, transcodar para mp4 e gerar hls agendado",
      maxSteps: 10,
    });

    expect(plan.steps.length).toBeGreaterThanOrEqual(5);
    expect(plan.title.toLowerCase()).toContain("capturar stream");
    expect(plan.steps.some((step) => step.title.toLowerCase().includes("captura"))).toBe(true);
    expect(plan.steps.some((step) => step.title.toLowerCase().includes("transcode"))).toBe(true);
    expect(plan.steps.some((step) => step.title.toLowerCase().includes("hls"))).toBe(true);
    expect(plan.steps.some((step) => step.title.toLowerCase().includes("schedule"))).toBe(true);
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
});
