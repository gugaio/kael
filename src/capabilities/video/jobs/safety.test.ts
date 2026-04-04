import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VideoJobValidationError,
  validateExistingInputPath,
  validateOutputPath,
  validateStreamUrl,
  validateUserArgs,
} from "./safety.js";

describe("video safety", () => {
  it("rejects args with blocked options", () => {
    expect(() => validateUserArgs(["-i", "input.mp4"], 24)).toThrow(VideoJobValidationError);
  });

  it("rejects stream URL with unsupported protocol", () => {
    expect(() => validateStreamUrl("file:///tmp/video.mp4")).toThrow(VideoJobValidationError);
  });

  it("rejects output path outside allowed roots when enabled", () => {
    expect(() =>
      validateOutputPath({
        value: "/etc/passwd",
        label: "outputPath",
        safePathsEnabled: true,
        allowedRoots: ["/tmp/kael-safe"],
      }),
    ).toThrow(VideoJobValidationError);
  });

  it("accepts existing local input inside allowed roots", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kael-safe-"));
    const input = path.join(tmpRoot, "input.txt");
    await fs.writeFile(input, "ok", "utf-8");

    await expect(
      validateExistingInputPath({
        value: input,
        label: "inputPath",
        safePathsEnabled: true,
        allowedRoots: [tmpRoot],
      }),
    ).resolves.toBeUndefined();
  });
});
