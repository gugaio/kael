import type { KaelConfig } from "../config.js";
import type { AgentEngine } from "./types.js";
import { HybridEngine } from "./hybrid-engine.js";
import { PiEngineAdapter } from "./pi-engine-adapter.js";
import { SimpleCommandEngine } from "./simple-engine.js";

export function createEngine(config: KaelConfig): AgentEngine {
  const simple = new SimpleCommandEngine();

  if (config.engineMode === "simple") {
    return simple;
  }

  const pi = new PiEngineAdapter(config.pi);

  if (config.engineMode === "pi") {
    return pi;
  }

  const safePiWithFallback: AgentEngine = {
    async runTurn(input) {
      try {
        return await pi.runTurn(input);
      } catch {
        return simple.runTurn(input);
      }
    },
  };

  return new HybridEngine(simple, safePiWithFallback);
}
