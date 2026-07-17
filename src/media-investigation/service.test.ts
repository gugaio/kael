import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaInvestigationService } from "./service.js";
import type { MediaInvestigationAgentRunner } from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("MediaInvestigationService", () => {
  it("executa especialistas em paralelo, sintetiza e persiste snapshots de prompt", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-media-investigation-"));
    tempDirs.push(root);
    const originRoot = path.join(root, "origin");
    await fs.mkdir(originRoot, { recursive: true });
    await fs.writeFile(path.join(originRoot, "index.m3u8"), "#EXTM3U\n", "utf-8");
    let active = 0;
    let maxActive = 0;
    const calls: string[] = [];
    let synthesizerToolCount = 0;
    const runner: MediaInvestigationAgentRunner = {
      available: true,
      model: "test-model",
      async run({ prompt, tools }) {
        calls.push(path.basename(prompt.path));
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 50));
        active -= 1;
        if (prompt.path.endsWith("synthesizer.md")) {
          synthesizerToolCount = tools?.length ?? 0;
          const parsed = {
            summary: "A equipe encontrou um gap de timeline.",
            likelyCause: "Problema observado no output empacotado.",
            confidence: 0.82,
            perceptualImpact: "Interrupcao perceptivel.",
            causalChain: ["gap", "interrupcao"],
            evidenceCoverage: 1,
            unresolvedEvidenceIds: [],
            rankedHypotheses: [{
              code: "timeline_gap",
              description: "Gap na timeline.",
              confidence: 0.82,
              explainedEvidenceIds: ["analysis.issue.0"],
              contradictingEvidenceIds: [],
            }],
            consensus: ["gap confirmado"],
            disagreements: [],
            nextSteps: ["executar decode profundo"],
          };
          return { raw: JSON.stringify(parsed), parsed };
        }
        const parsed = {
          summary: "Gap observado.",
          findings: [{
            code: "timeline_gap",
            severity: "error",
            confidence: 0.9,
            summary: "Gap entre segmentos.",
            evidenceIds: ["analysis.issue.0", "invented.id"],
          }],
          hypotheses: [],
          requestedChecks: [],
          limitations: ["Sem acesso upstream."],
        };
        return { raw: JSON.stringify(parsed), parsed };
      },
    };
    const streamer = {
      async inspectOrigin() {
        return {
          id: "origin-1",
          sourceUrl: "https://cdn.test/live.m3u8",
          protocol: "hls",
          segmentCount: 3,
          variantCount: 2,
          renditionCount: 1,
          cumulativeDurationSeconds: 18,
          bytes: 1024,
          rootDir: originRoot,
          playbackPath: "/index.m3u8",
        };
      },
      async probeOrigin() {
        return {
          entries: [{ label: "video", ok: true, errors: [] }],
        };
      },
      async analyzeOrigin() {
        return {
          issues: [{ code: "timeline_gap", summary: "gap", severity: "error", evidence: [] }],
          media: [{ label: "video", boundaryStatus: "warn", gopStatus: "ok" }],
          entries: [{ label: "video", segmentIndex: 1, streamSelector: "v:0", ok: true }],
        };
      },
    };
    const service = new MediaInvestigationService(
      streamer as never,
      runner,
      root,
      path.join(process.cwd(), ".kael", "agents", "media-investigation"),
    );
    await service.init();
    const started = await service.start({ originId: "origin-1" });

    await vi.waitFor(() => {
      expect(service.get(started.id)?.state).toBe("completed");
    });

    const completed = service.get(started.id)!;
    expect(maxActive).toBe(3);
    expect(calls).toHaveLength(4);
    expect(synthesizerToolCount).toBe(5);
    expect(completed.synthesis?.confidence).toBe(0.82);
    expect(completed.agents[0].prompt.version).toBe("1.2.0");
    expect(completed.problemStatement).toContain("triagem geral");
    expect(completed.agents[0].prompt.hash).toHaveLength(16);
    expect(completed.agents[0].output?.findings[0].evidenceIds).toEqual(["analysis.issue.0"]);
    expect(JSON.parse(await fs.readFile(path.join(root, `${started.id}.json`), "utf-8")).state).toBe("completed");
  });
});
