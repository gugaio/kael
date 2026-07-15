import type { AgentEngine } from "../agents/types.js";
import { isSlashCommand, SimpleCommandEngine } from "../agents/simple-engine.js";
import type { AgentContext } from "../agents/context.js";

export type CommandRouterInput = {
  sessionKey: string;
  message: string;
  requestId?: string;
  context: AgentContext;
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
      context: input.context,
    });
    return {
      handled: true,
      reply: turn.reply,
    };
  }
}
