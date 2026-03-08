import { describe, expect, it, vi } from "vitest";
import { createPiShellTools } from "./pi-tools.js";
import type { EngineTooling } from "./types.js";

function createTooling(overrides: Partial<EngineTooling> = {}): EngineTooling {
  return {
    ...overrides,
  } as EngineTooling;
}

describe("createPiShellTools image_generate", () => {
  it("returns failed result instead of throwing when generation errors", async () => {
    const tools = createPiShellTools({
      sessionKey: "s1",
      tooling: createTooling({
        imageGenerate: async () => {
          throw new Error("image backend timeout");
        },
      }),
    });
    const tool = tools.find((item) => item.name === "image_generate");
    expect(tool).toBeTruthy();

    const result = await tool!.execute("tc-1", { prompt: "dragao neon" });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");
    expect(text).toContain("ok=false");
    expect(text).toContain("reason=image_generate_failed");
    expect(text).toContain("image backend timeout");
  });

  it("blocks a second image generation call in same turn budget", async () => {
    const imageGenerate = vi.fn(async () => ({
      kind: "image" as const,
      dataBase64: "aGVsbG8=",
      mimeType: "image/png",
      fileName: "img.png",
    }));
    const tools = createPiShellTools({
      sessionKey: "s1",
      tooling: createTooling({
        imageGenerate,
      }),
    });
    const tool = tools.find((item) => item.name === "image_generate");
    expect(tool).toBeTruthy();

    const first = await tool!.execute("tc-1", { prompt: "primeira" });
    const second = await tool!.execute("tc-2", { prompt: "segunda" });

    const firstText = String((first.content?.[0] as { text?: unknown })?.text ?? "");
    const secondText = String((second.content?.[0] as { text?: unknown })?.text ?? "");

    expect(firstText).toContain("ok=true");
    expect(secondText).toContain("blocked=true");
    expect(secondText).toContain("image_generate_budget_exceeded:1/1");
    expect(imageGenerate).toHaveBeenCalledTimes(1);
  });
});

describe("createPiShellTools browser budget", () => {
  it("bloqueia segunda chamada de browser quando maxBrowserCalls=1", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-browser",
      tooling: createTooling({
        browserCommand: async ({ action }) => ({
          ok: true,
          action,
          status: "started",
          message: "ok",
        }),
      }),
      budget: {
        maxToolCalls: 5,
        maxBrowserCalls: 1,
      },
    });
    const tool = tools.find((item) => item.name === "browser");
    expect(tool).toBeTruthy();

    const first = await tool!.execute("tc-1", { action: "start" });
    const second = await tool!.execute("tc-2", { action: "start" });

    const firstText = String((first.content?.[0] as { text?: unknown })?.text ?? "");
    const secondText = String((second.content?.[0] as { text?: unknown })?.text ?? "");

    expect(firstText).toContain("ok=true");
    expect(secondText).toContain("blocked=true");
    expect(secondText).toContain("browser_budget_exceeded:1/1");
  });
});

describe("createPiShellTools jobs/plans state tools", () => {
  it("exposes jobs_list and jobs_get using tooling state methods", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-jobs",
      tooling: createTooling({
        listJobs: () => [
          {
            id: "job-1",
            capability: "video",
            action: "transcode",
            status: "succeeded",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        getJob: () =>
          ({
            id: "job-1",
            capability: "video",
            action: "transcode",
            status: "succeeded",
            sessionKey: "s1",
            command: "ffmpeg",
            input: "/tmp/in.mp4",
            args: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            logPath: "/tmp/job-1.log",
          }) as never,
      }),
    });
    const listTool = tools.find((item) => item.name === "jobs_list");
    const getTool = tools.find((item) => item.name === "jobs_get");
    expect(listTool).toBeTruthy();
    expect(getTool).toBeTruthy();

    const listResult = await listTool!.execute("tc-list", {});
    const getResult = await getTool!.execute("tc-get", { jobId: "job-1" });
    const listText = String((listResult.content?.[0] as { text?: unknown })?.text ?? "");
    const getText = String((getResult.content?.[0] as { text?: unknown })?.text ?? "");

    expect(listText).toContain("jobs=1");
    expect(listText).toContain("video/transcode");
    expect(getText).toContain("found=true");
    expect(getText).toContain("jobId=job-1");
  });

  it("exposes plan_get and returns not found when plan is absent", async () => {
    const tools = createPiShellTools({
      sessionKey: "s-plan",
      tooling: createTooling({
        planGet: () => null,
      }),
    });
    const planGetTool = tools.find((item) => item.name === "plan_get");
    expect(planGetTool).toBeTruthy();

    const result = await planGetTool!.execute("tc-plan", { planId: "plan-404" });
    const text = String((result.content?.[0] as { text?: unknown })?.text ?? "");
    expect(text).toContain("found=false");
  });
});
