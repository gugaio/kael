import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessRunner } from "../process/runner.js";
import { createMediaInvestigationTools } from "./content-tools.js";
import type { MediaContentQaEvidence, MediaInvestigationActivity } from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("createMediaInvestigationTools", () => {
  it("comprova EXT-X-DISCONTINUITY ausente no boundary solicitado", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "kael-manifest-tools-"));
    tempDirs.push(rootDir);
    await fs.writeFile(path.join(rootDir, "index.m3u8"), [
      "#EXTM3U",
      "#EXT-X-MEDIA-SEQUENCE:10",
      "#EXT-X-DISCONTINUITY-SEQUENCE:3",
      "#EXTINF:4.000,source",
      "source_000.ts",
      "#EXTINF:4.000,source",
      "source_001.ts",
      "#EXTINF:4.000,ad",
      "ad_000.ts",
      "#EXT-X-DISCONTINUITY",
      "#EXTINF:4.000,ad",
      "ad_001.ts",
      "#EXT-X-ENDLIST",
    ].join("\n"), "utf-8");
    const activities: MediaInvestigationActivity[] = [];
    const evidences: MediaContentQaEvidence[] = [];
    const runner = fakeRunner("");
    const tools = await createMediaInvestigationTools({
      origin: { id: "missing-discontinuity", rootDir, playbackPath: "/index.m3u8", protocol: "hls" } as never,
      runner,
      callbacks: {
        onActivity: async (activity) => { activities.push({ ...activity }); },
        onEvidence: async (evidence) => { evidences.push(evidence); },
      },
    });

    const tool = tools.find((candidate) => candidate.name === "media_manifest_inspect");
    const result = await tool!.execute("call-manifest", {
      reason: "confirmar se o reset de PTS no segmento 2 foi sinalizado",
      segmentIndex: 2,
    });
    const text = String((result.content[0] as { text: string }).text);

    expect(evidences).toHaveLength(1);
    expect(evidences[0]).toMatchObject({
      id: "manifest.boundary.0",
      kind: "manifest",
      playlist: "index.m3u8",
      segmentIndex: 2,
      segmentUri: "ad_000.ts",
      mediaSequence: 10,
      discontinuitySequence: 3,
      discontinuityCount: 1,
      hasDiscontinuityBefore: false,
      previousTags: ["#EXTINF:4.000,ad"],
    });
    expect(text).toContain("EXT-X-DISCONTINUITY before=false");
    expect(activities.map((activity) => activity.state)).toEqual(["running", "completed"]);
    expect(runner.spawn).not.toHaveBeenCalled();
  });

  it("detecta e une freeze continuo dividido por boundary HLS", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "kael-content-tools-"));
    tempDirs.push(rootDir);
    await fs.writeFile(path.join(rootDir, "index.m3u8"), "#EXTM3U\n", "utf-8");
    const activities: MediaInvestigationActivity[] = [];
    const evidences: MediaContentQaEvidence[] = [];
    const runner = fakeRunner([
      "lavfi.freezedetect.freeze_start: 2.96963",
      "lavfi.freezedetect.freeze_duration: 1.03437",
      "lavfi.freezedetect.freeze_end: 4.004",
      "lavfi.freezedetect.freeze_start: 4.004",
      "lavfi.freezedetect.freeze_duration: 0.967633",
      "lavfi.freezedetect.freeze_end: 4.97163",
    ].join("\n"));
    const tools = await createMediaInvestigationTools({
      origin: { id: "gap3s", rootDir, playbackPath: "/index.m3u8", protocol: "hls" } as never,
      runner,
      callbacks: {
        onActivity: async (activity) => { activities.push({ ...activity }); },
        onEvidence: async (evidence) => { evidences.push(evidence); },
      },
    });

    const tool = tools.find((candidate) => candidate.name === "media_freeze_detect");
    const result = await tool!.execute("call-1", { reason: "confirmar travada visual", minDurationSeconds: 0.5 });
    const text = String((result.content[0] as { text: string }).text);

    expect(runner.spawn).toHaveBeenCalledWith("ffmpeg", expect.arrayContaining(["freezedetect=n=-50dB:d=0.5"]));
    expect(evidences).toHaveLength(1);
    expect(evidences[0]).toMatchObject({
      id: "content.freeze.0",
      kind: "freeze",
      startSeconds: expect.closeTo(2.96963, 5),
      endSeconds: expect.closeTo(4.97163, 5),
      durationSeconds: expect.closeTo(2.002, 3),
    });
    expect(activities.map((activity) => activity.state)).toEqual(["running", "completed"]);
    expect(text).toContain("evidenceId=content.freeze.0");
  });
});

function fakeRunner(stderrText: string): ProcessRunner & { spawn: ReturnType<typeof vi.fn> } {
  const spawn = vi.fn(() => {
    const process = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    process.stdin = new PassThrough();
    process.stdout = new PassThrough();
    process.stderr = new PassThrough();
    process.kill = vi.fn(() => true);
    setTimeout(() => {
      process.stderr.write(stderrText);
      process.stderr.end();
      process.emit("close", 0);
    }, 0);
    return { process: process as never };
  });
  return { spawn };
}
