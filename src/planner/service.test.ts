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
});
