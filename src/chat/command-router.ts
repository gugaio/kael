import type { AgentEngine, EngineTooling } from "../engine/types.js";
import { isSlashCommand, SimpleCommandEngine } from "../engine/simple-engine.js";

export type CommandRouterInput = {
  sessionKey: string;
  message: string;
  requestId?: string;
  tooling: EngineTooling;
  allowOperationalShortcuts: boolean;
};

export type CommandRouterResult =
  | { handled: true; reply: string }
  | { handled: false };

export class CommandRouter {
  constructor(private readonly commandEngine: AgentEngine = new SimpleCommandEngine()) {}

  async tryRoute(input: CommandRouterInput): Promise<CommandRouterResult> {
    if (!input.allowOperationalShortcuts || !isSlashCommand(input.message)) {
      return { handled: false };
    }

    const turn = await this.commandEngine.runTurn({
      sessionKey: input.sessionKey,
      message: input.message,
      requestId: input.requestId,
      tooling: input.tooling,
    });
    return {
      handled: true,
      reply: turn.reply,
    };
  }
}
