import { describe, expect, it } from "vitest";
import { ChatRoutingTelemetry } from "./routing-telemetry.js";

describe("ChatRoutingTelemetry", () => {
  it("acumula contadores por rota e total", () => {
    const telemetry = new ChatRoutingTelemetry();
    telemetry.record("compact");
    telemetry.record("fast_path");
    telemetry.record("llm_turn");
    telemetry.record("fast_path");

    const snapshot = telemetry.snapshot();
    expect(snapshot.total).toBe(4);
    expect(snapshot.compact).toBe(1);
    expect(snapshot.fastPath).toBe(2);
    expect(snapshot.llmTurn).toBe(1);
    expect(snapshot.lastRouteKind).toBe("fast_path");
    expect(typeof snapshot.lastRouteAt).toBe("string");
  });
});
