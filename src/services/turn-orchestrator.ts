import type { AgentEngine, EngineTooling, EngineTurnInput, EngineTurnOutput } from "../engine/types.js";
import type { SessionStore } from "../session/store.js";

type TurnOrchestratorConfig = {
  maxContextMessages: number;
  maxContextChars: number;
};

type OrchestratedTurnInput = {
  sessionKey: string;
  message: string;
  tooling: EngineTooling;
};

type ContextMessage = NonNullable<EngineTurnInput["contextMessages"]>[number];

function isConversationRole(role: string): role is "user" | "assistant" {
  return role === "user" || role === "assistant";
}

export class TurnOrchestrator {
  constructor(
    private readonly sessions: SessionStore,
    private readonly engine: AgentEngine,
    private readonly cfg: TurnOrchestratorConfig,
  ) {}

  async run(input: OrchestratedTurnInput): Promise<EngineTurnOutput> {
    const contextMessages = await this.buildContextMessages(input.sessionKey, input.message);

    return this.engine.runTurn({
      sessionKey: input.sessionKey,
      message: input.message,
      contextMessages,
      tooling: input.tooling,
    });
  }

  private async buildContextMessages(
    sessionKey: string,
    currentMessage: string,
  ): Promise<ContextMessage[]> {
    const fetchLimit = Math.max(this.cfg.maxContextMessages * 4, this.cfg.maxContextMessages);
    const history = await this.sessions.getMessages(sessionKey, fetchLimit);
    const conversational: ContextMessage[] = history
      .filter((message) => isConversationRole(message.role))
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
        createdAt: message.createdAt,
      }));

    // A mensagem atual ja chega separada em `input.message`; removemos a ultima entrada igual para evitar duplicacao.
    if (conversational.length > 0) {
      const last = conversational[conversational.length - 1];
      if (last.role === "user" && last.content === currentMessage) {
        conversational.pop();
      }
    }

    const byMessageCount =
      this.cfg.maxContextMessages > 0
        ? conversational.slice(-this.cfg.maxContextMessages)
        : conversational;

    const selected: ContextMessage[] = [];
    let usedChars = 0;

    for (let idx = byMessageCount.length - 1; idx >= 0; idx -= 1) {
      const candidate = byMessageCount[idx];
      const size = candidate.content.length;
      if (this.cfg.maxContextChars > 0 && selected.length > 0 && usedChars + size > this.cfg.maxContextChars) {
        break;
      }
      selected.push(candidate);
      usedChars += size;
      if (this.cfg.maxContextChars > 0 && usedChars >= this.cfg.maxContextChars) {
        break;
      }
    }

    return selected.reverse();
  }
}
