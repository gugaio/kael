import type { AgentEngine, EngineTurnInput, EngineTurnOutput } from "./types.js";
import { isSlashCommand } from "./simple-engine.js";

export class HybridEngine implements AgentEngine {
  constructor(
    private readonly commandEngine: AgentEngine,
    private readonly defaultEngine: AgentEngine,
  ) {}

  async runTurn(input: EngineTurnInput): Promise<EngineTurnOutput> {
    if (isSlashCommand(input.message)) {
      return this.commandEngine.runTurn(input);
    }

    return this.defaultEngine.runTurn(input);
  }

  getRuntimeTelemetrySnapshot() {
    const fromDefault = this.defaultEngine.getRuntimeTelemetrySnapshot?.();
    if (fromDefault) {
      return fromDefault;
    }
    return (
      this.commandEngine.getRuntimeTelemetrySnapshot?.() ?? {
        timeouts: 0,
        toolCallsByName: {},
        blockedCallsByTool: {},
      }
    );
  }
}
