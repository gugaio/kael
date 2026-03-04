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
