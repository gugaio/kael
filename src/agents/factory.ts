import path from "node:path";
import type { KaelConfig } from "../config.js";
import { shouldFallbackOnPiError } from "./pi-errors.js";
import type { AgentEngine } from "./types.js";
import { HybridEngine } from "./hybrid-engine.js";
import { PiEngineAdapter } from "./pi-engine-adapter.js";
import { SimpleCommandEngine } from "./simple-engine.js";
import { PiAgentRuntime } from "./pi-runtime.js";

export function createEngine(config: KaelConfig, runtime: PiAgentRuntime = new PiAgentRuntime(config.pi)): AgentEngine {
  const simple = new SimpleCommandEngine();

  if (config.engineMode === "simple") {
    return simple;
  }

  const pi = new PiEngineAdapter(config.pi, {
    dumpEnabled: true,
    failureDumpDir: path.join(config.dataDir, "debug", "pi-failures"),
  }, runtime);

  if (config.engineMode === "pi") {
    return pi;
  }

  const safePiWithFallback: AgentEngine = {
    async runTurn(input) {
      try {
        return await pi.runTurn(input);
      } catch (error) {
        if (!shouldFallbackOnPiError(error)) {
          throw error;
        }
        return simple.runTurn(input);
      }
    },
    getRuntimeTelemetrySnapshot() {
      return pi.getRuntimeTelemetrySnapshot();
    },
  };

  return new HybridEngine(simple, safePiWithFallback);
}
