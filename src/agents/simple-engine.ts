import { runSimpleCommand } from "./simple-engine-commands.js";
import type { AgentEngine, EngineTurnInput } from "./types.js";

export { isSlashCommand } from "./simple-engine-commands.js";

export class SimpleCommandEngine implements AgentEngine {
  async runTurn(input: EngineTurnInput) {
    return runSimpleCommand(input);
  }

  getRuntimeTelemetrySnapshot() {
    return {
      timeouts: 0,
      toolCallsByName: {},
      blockedCallsByTool: {},
    };
  }
}
