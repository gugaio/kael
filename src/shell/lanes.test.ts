import { describe, expect, it } from "vitest";
import { LaneQueue } from "./lanes.js";

describe("LaneQueue", () => {
  it("libera o slot depois de uma execucao concluida", async () => {
    const queue = new LaneQueue({ agent: { concurrency: 1 } });

    await expect(queue.runInLane("agent", async () => "first")).resolves.toBe("first");
    expect(queue.getStats().agent).toEqual({
      active: 0,
      queued: 0,
      maxConcurrent: 1,
    });

    await expect(queue.runInLane("agent", async () => "second")).resolves.toBe("second");
  });

  it("inicia a proxima execucao quando o slot ocupado e liberado", async () => {
    const queue = new LaneQueue({ agent: { concurrency: 1 } });
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.runInLane("agent", async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });
    const second = queue.runInLane("agent", async () => {
      events.push("second:start");
    });

    expect(queue.getStats().agent).toEqual({
      active: 1,
      queued: 1,
      maxConcurrent: 1,
    });
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(["first:start", "first:end", "second:start"]);
    expect(queue.getStats().agent).toEqual({
      active: 0,
      queued: 0,
      maxConcurrent: 1,
    });
  });
});
