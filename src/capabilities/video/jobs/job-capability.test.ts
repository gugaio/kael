import { describe, expect, it, vi } from "vitest";
import { VideoJobCapability, VIDEO_JOB_ACTIONS } from "./job-capability.js";
import { VideoJobValidationError } from "./safety.js";

function createCapability() {
  return new VideoJobCapability({
    startTranscode: vi.fn(),
    startConvertHls: vi.fn(),
    startCaptureStream: vi.fn(),
    startProbeMedia: vi.fn(),
    startProbeUrl: vi.fn(),
    startPlayVlc: vi.fn(),
    getRuntimeStats: vi.fn(),
    cancelJob: vi.fn(),
  } as never);
}

describe("VideoJobCapability", () => {
  it("rejects invalid transcode payload before reaching service", async () => {
    const capability = createCapability();

    expect(() => capability.actions[VIDEO_JOB_ACTIONS.transcode]("invalid")).toThrowError(
      VideoJobValidationError,
    );
  });

  it("rejects invalid probe_url payload before reaching service", async () => {
    const capability = createCapability();

    expect(() =>
      capability.actions[VIDEO_JOB_ACTIONS.probeUrl]({ sessionKey: "s1", streamUrl: 123 }),
    ).toThrowError(VideoJobValidationError);
  });
});
