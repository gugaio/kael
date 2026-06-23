import { describe, expect, it } from "vitest";
import {
  buildJobLogTailResult,
  formatJobDetailsText,
  formatJobLogText,
  formatJobsListText,
  selectJobs,
} from "./tooling.js";
import type { JobRecord } from "../types.js";

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "j1",
    sessionKey: "s1",
    command: "ffmpeg",
    input: "/tmp/in.mp4",
    output: "/tmp/out.mp4",
    args: [],
    status: "succeeded",
    createdAt: "2026-03-07T00:00:00.000Z",
    startedAt: "2026-03-07T00:00:01.000Z",
    endedAt: "2026-03-07T00:00:02.000Z",
    exitCode: 0,
    logPath: "/tmp/j1.log",
    ...overrides,
  };
}

describe("jobs/tooling", () => {
  it("filtra jobs e respeita limit", () => {
    const jobs = [
      makeJob({ id: "j1", sessionKey: "a" }),
      makeJob({ id: "j2", sessionKey: "a" }),
      makeJob({ id: "j3", sessionKey: "b" }),
    ];
    const result = selectJobs(jobs, { sessionKey: "a", limit: 5 });
    expect(result).toHaveLength(2);
  });

  it("gera tail de log quando solicitado", () => {
    const result = buildJobLogTailResult({
      jobId: "j1",
      text: "abcdef",
      tailChars: 3,
    });
    expect(result).toEqual({ jobId: "j1", found: true, log: "def" });
  });

  it("formata saidas de texto de jobs", () => {
    const job = makeJob();
    expect(formatJobsListText([{ id: "j1", status: "completed", createdAt: "x" }])).toContain("jobs=1");
    expect(formatJobDetailsText(job)).toContain("jobId=j1");
    expect(formatJobLogText({ jobId: "j1", log: "ok" })).toContain("chars=2");
  });
});
