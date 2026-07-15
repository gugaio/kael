import type { AgentEngine, EngineTurnInput, EngineTurnOutput } from "../agents/types.js";
import { kaelLogger } from "../infra/logger.js";
import type { AgentContext } from "../agents/context.js";
import type { SessionStore } from "../session/store.js";
import type { SessionMessage } from "../types.js";

type TurnOrchestratorConfig = {
  maxContextMessages: number;
  maxContextChars: number;
};

type OrchestratedTurnInput = {
  sessionKey: string;
  message: string;
  attachments?: EngineTurnInput["attachments"];
  requestId?: string;
  context: AgentContext;
};

type UtilityTurnInput = {
  sessionKey: string;
  message: string;
  attachments?: EngineTurnInput["attachments"];
  requestId?: string;
  context: AgentContext;
  excludeCurrentMessage?: string | null;
};

type ContextMessage = NonNullable<EngineTurnInput["contextMessages"]>[number];
export type ContextCompactionResult = {
  compacted: boolean;
  reason:
    | "no_messages"
    | "recent_compaction"
    | "below_threshold"
    | "not_enough_older"
    | "compaction_needed"
    | "compacted";
  summarizedMessages: number;
  totalMessages: number;
  totalChars: number;
};

function isConversationRole(role: string): role is "user" | "assistant" | "system" {
  return role === "user" || role === "assistant" || role === "system";
}

const COMPACTION_PREFIX = "[compaction]";

// Multiplica a janela de contexto para determinar quando compactar.
// Ex: maxContextMessages=24 → threshold=72 mensagens.
const COMPACTION_THRESHOLD_MULTIPLIER = 3;
// Piso minimo extra para configs pequenos nao dispararem compaction cedo demais.
const COMPACTION_MIN_EXTRA_MESSAGES = 12;
const COMPACTION_MIN_EXTRA_CHARS = 4000;
// Quantas mensagens recentes buscar para compaction (multiplo da janela).
const COMPACTION_FETCH_MULTIPLIER = 12;
// Quantas mensagens recentes buscar para construir contexto.
const CONTEXT_FETCH_MULTIPLIER = 4;
// Quantidade minima de novas mensagens user/assistant para nova compaction apos watermark.
const COMPACTION_MIN_NEW_MESSAGES_SINCE_LAST = 12;

function isUserOrAssistant(
  message: SessionMessage,
): message is SessionMessage & { role: "user" | "assistant" } {
  return message.role === "user" || message.role === "assistant";
}

export class TurnOrchestrator {
  constructor(
    private readonly sessions: SessionStore,
    private readonly agent: AgentEngine,
    private readonly cfg: TurnOrchestratorConfig,
  ) {}

  /**
   * Executa um turno do engine com contexto construido a partir do historico.
   *
   * NOTA: compaction nao e feita aqui — e responsabilidade do caller
   * (MemoryOrchestrator via runAutoCompactionWithMemoryFlushIfNeeded).
   * Isso evita chamadas duplicadas a getMessages.
   */
  async runConversationTurn(input: OrchestratedTurnInput): Promise<EngineTurnOutput> {
    const contextMessages = await this.buildContextMessages(input.sessionKey, input.message);

    return this.agent.runTurn({
      sessionKey: input.sessionKey,
      message: input.message,
      attachments: input.attachments,
      requestId: input.requestId,
      contextMessages,
      context: input.context,
    });
  }

  getEngineRuntimeTelemetrySnapshot() {
    return (
      this.agent.getRuntimeTelemetrySnapshot?.() ?? {
        timeouts: 0,
        toolCallsByName: {},
        blockedCallsByTool: {},
      }
    );
  }

  async runTurnWithExcludedMessage(input: UtilityTurnInput): Promise<EngineTurnOutput> {
    const contextMessages = await this.buildContextMessages(
      input.sessionKey,
      input.excludeCurrentMessage ?? "",
    );
    return this.agent.runTurn({
      sessionKey: input.sessionKey,
      message: input.message,
      attachments: input.attachments,
      requestId: input.requestId,
      contextMessages,
      context: input.context,
    });
  }

  async compactNow(input: { sessionKey: string; currentMessage?: string }): Promise<ContextCompactionResult> {
    return this.compactContext(input.sessionKey, input.currentMessage ?? null, true, true);
  }

  async checkCompactionNeed(input: {
    sessionKey: string;
    currentMessage?: string;
  }): Promise<ContextCompactionResult> {
    return this.compactContext(input.sessionKey, input.currentMessage ?? null, false, false);
  }

  private async buildContextMessages(
    sessionKey: string,
    currentMessage: string,
  ): Promise<ContextMessage[]> {
    const fetchLimit = this.cfg.maxContextMessages * CONTEXT_FETCH_MULTIPLIER;
    const history = await this.sessions.getMessages(sessionKey, fetchLimit);
    const conversational: ContextMessage[] = history
      .filter((message) => isConversationRole(message.role))
      .map((message) => ({
        role:
          message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
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

  private async compactContext(
    sessionKey: string,
    currentMessage: string | null,
    force: boolean,
    apply: boolean,
  ): Promise<ContextCompactionResult> {
    const watermark = await this.sessions.getCompactionWatermark(sessionKey);
    const fetchLimit = this.cfg.maxContextMessages * COMPACTION_FETCH_MULTIPLIER;
    const history = await this.sessions.getMessages(sessionKey, fetchLimit);
    const conversational = history.filter(isUserOrAssistant);
    if (conversational.length === 0) {
      return {
        compacted: false,
        reason: "no_messages",
        summarizedMessages: 0,
        totalMessages: 0,
        totalChars: 0,
      };
    }

    const trimmed = [...conversational];
    const last = trimmed[trimmed.length - 1];
    if (currentMessage && last?.role === "user" && last.content === currentMessage) {
      trimmed.pop();
    }

    const minNewSinceLastCompaction = Math.max(
      this.cfg.maxContextMessages,
      COMPACTION_MIN_NEW_MESSAGES_SINCE_LAST,
    );
    const hasWatermark = watermark.lastCompactionUserAssistantCount != null || watermark.lastCompactionAt != null;
    const newUserAssistantMessagesSinceLastCompaction = hasWatermark
      ? Math.max(
          0,
          watermark.userAssistantCount - (watermark.lastCompactionUserAssistantCount ?? watermark.userAssistantCount),
        )
      : null;

    if (
      !force &&
      newUserAssistantMessagesSinceLastCompaction != null &&
      newUserAssistantMessagesSinceLastCompaction < minNewSinceLastCompaction
    ) {
      const totalCharsRecent = trimmed.reduce((acc, item) => acc + item.content.length, 0);
      return {
        compacted: false,
        reason: "recent_compaction",
        summarizedMessages: 0,
        totalMessages: trimmed.length,
        totalChars: totalCharsRecent,
      };
    }

    const hasRecentCompactionInHistory = history
      .slice(-20)
      .some((message) => message.role === "system" && message.content.startsWith(COMPACTION_PREFIX));
    if (!force && !hasWatermark && hasRecentCompactionInHistory) {
      const totalCharsRecent = trimmed.reduce((acc, item) => acc + item.content.length, 0);
      return {
        compacted: false,
        reason: "recent_compaction",
        summarizedMessages: 0,
        totalMessages: trimmed.length,
        totalChars: totalCharsRecent,
      };
    }

    const totalChars = trimmed.reduce((acc, item) => acc + item.content.length, 0);
    // Compacta quando o historico atinge N vezes a janela de contexto,
    // mas com piso minimo para configs pequenos (ex: maxContextMessages=2 → threshold=14, nao 6).
    const messageThreshold = Math.max(
      this.cfg.maxContextMessages * COMPACTION_THRESHOLD_MULTIPLIER,
      this.cfg.maxContextMessages + COMPACTION_MIN_EXTRA_MESSAGES,
    );
    const charsThreshold = Math.max(
      this.cfg.maxContextChars * COMPACTION_THRESHOLD_MULTIPLIER,
      this.cfg.maxContextChars + COMPACTION_MIN_EXTRA_CHARS,
    );
    const shouldCompact = trimmed.length > messageThreshold || totalChars > charsThreshold;
    if (!force && !shouldCompact) {
      return {
        compacted: false,
        reason: "below_threshold",
        summarizedMessages: 0,
        totalMessages: trimmed.length,
        totalChars,
      };
    }

    const keepRecent = Math.max(this.cfg.maxContextMessages, 12);
    const older = trimmed.slice(0, Math.max(0, trimmed.length - keepRecent));
    if (older.length < 6) {
      return {
        compacted: false,
        reason: "not_enough_older",
        summarizedMessages: 0,
        totalMessages: trimmed.length,
        totalChars,
      };
    }

    if (!apply) {
      return {
        compacted: false,
        reason: "compaction_needed",
        summarizedMessages: older.length,
        totalMessages: trimmed.length,
        totalChars,
      };
    }

    const summary = this.summarizeForCompaction(older);
    await this.sessions.appendMessage(sessionKey, "system", `${COMPACTION_PREFIX}\n${summary}`);
    await this.sessions.markCompaction(sessionKey);
    kaelLogger.info("session.context.compacted", {
      sessionKey,
      summarizedMessages: older.length,
      totalMessages: trimmed.length,
      totalChars,
      forced: force,
      userAssistantCount: watermark.userAssistantCount,
      newUserAssistantMessagesSinceLastCompaction,
    });
    return {
      compacted: true,
      reason: "compacted",
      summarizedMessages: older.length,
      totalMessages: trimmed.length,
      totalChars,
    };
  }

  private summarizeForCompaction(messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>): string {
    const first = messages[0]?.createdAt ?? "";
    const last = messages[messages.length - 1]?.createdAt ?? "";
    const snippets = messages
      .slice(-16)
      .map((message) => {
        const clean = message.content.replace(/\s+/g, " ").trim();
        const clipped = clean.length > 180 ? `${clean.slice(0, 180)}...` : clean;
        return `- ${message.role}: ${clipped}`;
      })
      .join("\n");

    return [
      "Resumo automatico de contexto antigo para preservar janela de tokens.",
      `Janela resumida: ${first} -> ${last}`,
      `Mensagens resumidas: ${messages.length}`,
      "Trechos mais recentes da janela resumida:",
      snippets,
      "Use este resumo como contexto historico; priorize mensagens recentes fora da compaction.",
    ].join("\n");
  }
}
