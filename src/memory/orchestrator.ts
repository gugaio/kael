import { kaelLogger } from "../infra/logger.js";
import type { SessionStore } from "../session/store.js";
import type { AgentContext } from "../agents/context.js";
import type { MemoryService } from "./service.js";
import type { TurnOrchestrator } from "../chat/turn-orchestrator.js";
import {
  isCompactCommand,
  todayMemoryRelPath,
  buildMemoryFlushPrompt,
  buildLongTermPromotionPrompt,
  buildHeuristicDailyFlushNote,
} from "./policy.js";

type MemoryFlushResult = {
  written: boolean;
  path?: string;
  reason?: string;
  includedMessages: number;
};

type LongTermPromoteResult = {
  written: boolean;
  reason?: string;
};

type OrchestratorParams = {
  sessionKey: string;
  currentMessage: string;
  context: AgentContext;
  requestId?: string;
};

export class MemoryOrchestrator {
  constructor(
    private readonly sessions: SessionStore,
    private readonly memory: MemoryService,
    private readonly turns: TurnOrchestrator,
  ) {}

  isCompactCommand(input: string): boolean {
    return isCompactCommand(input);
  }

  async runManualCompact(params: OrchestratorParams): Promise<{
    flush: MemoryFlushResult;
    promote: LongTermPromoteResult;
    compaction: Awaited<ReturnType<TurnOrchestrator["compactNow"]>>;
  }> {
    const flush = await this.flushSessionToDailyMemory(params);
    const promote = await this.promoteLongTermMemoryIfNeeded(params);
    const compaction = await this.turns.compactNow({
      sessionKey: params.sessionKey,
      currentMessage: params.currentMessage,
    });
    return { flush, promote, compaction };
  }

  async runAutoCompactionWithMemoryFlushIfNeeded(params: OrchestratorParams): Promise<void> {
    const need = await this.turns.checkCompactionNeed({
      sessionKey: params.sessionKey,
      currentMessage: params.currentMessage,
    });
    if (need.reason !== "compaction_needed") {
      return;
    }

    kaelLogger.info("chat.compact.auto.started", {
      sessionKey: params.sessionKey,
      requestId: params.requestId ?? null,
      totalMessages: need.totalMessages,
      totalChars: need.totalChars,
      summarizedMessages: need.summarizedMessages,
    });

    const flush = await this.flushSessionToDailyMemory(params);
    const promote = await this.promoteLongTermMemoryIfNeeded(params);
    const compaction = await this.turns.compactNow({
      sessionKey: params.sessionKey,
      currentMessage: params.currentMessage,
    });

    kaelLogger.info("chat.compact.auto.finished", {
      sessionKey: params.sessionKey,
      requestId: params.requestId ?? null,
      flushWritten: flush.written,
      flushReason: flush.reason ?? null,
      flushPath: flush.path ?? null,
      longTermWritten: promote.written,
      longTermReason: promote.reason ?? null,
      compactionApplied: compaction.compacted,
      compactionReason: compaction.reason,
      compactionSummarizedMessages: compaction.summarizedMessages,
    });
  }

  private async flushSessionToDailyMemory(params: OrchestratorParams): Promise<MemoryFlushResult> {
    const llmFlush = await this.tryLlmMemoryFlush(params);
    if (llmFlush.written) {
      return llmFlush;
    }

    const history = await this.sessions.getMessages(params.sessionKey, 80);
    const heuristic = buildHeuristicDailyFlushNote({
      sessionKey: params.sessionKey,
      currentMessage: params.currentMessage,
      history,
    });
    if (!heuristic) {
      return {
        written: false,
        reason: "not_enough_conversation",
        includedMessages: 0,
      };
    }
    const write = await this.memory.write({
      content: heuristic.note,
      target: "daily",
    });
    return {
      written: true,
      path: write.path,
      reason: llmFlush.reason ? `heuristic_fallback_after_${llmFlush.reason}` : heuristic.reason,
      includedMessages: heuristic.includedMessages,
    };
  }

  private async tryLlmMemoryFlush(params: OrchestratorParams): Promise<MemoryFlushResult> {
    const relPath = todayMemoryRelPath();
    const before = await this.readMemorySnapshot(relPath);
    kaelLogger.info("chat.compact.memory_flush.started", {
      sessionKey: params.sessionKey,
      requestId: params.requestId ?? null,
      mode: "llm",
    });
    try {
      await this.turns.runTurnWithExcludedMessage({
        sessionKey: params.sessionKey,
        message: buildMemoryFlushPrompt(),
        requestId: params.requestId ? `${params.requestId}:compact-flush` : undefined,
        context: params.context,
        excludeCurrentMessage: params.currentMessage,
      });
    } catch (error) {
      kaelLogger.warn("chat.compact.memory_flush.failed", {
        sessionKey: params.sessionKey,
        requestId: params.requestId ?? null,
        mode: "llm",
        error: error instanceof Error ? error.message : String(error),
      });
      return { written: false, reason: "llm_error", includedMessages: 0 };
    }
    const after = await this.readMemorySnapshot(relPath);
    const wrote = (after.length ?? 0) > (before.length ?? 0);
    kaelLogger.info("chat.compact.memory_flush.finished", {
      sessionKey: params.sessionKey,
      requestId: params.requestId ?? null,
      mode: "llm",
      wroteDaily: wrote,
      beforeLen: before.length ?? 0,
      afterLen: after.length ?? 0,
      path: relPath,
    });
    return {
      written: wrote,
      path: wrote ? relPath : undefined,
      reason: wrote ? "llm_flush" : "llm_no_daily_write",
      includedMessages: 0,
    };
  }

  private async promoteLongTermMemoryIfNeeded(params: OrchestratorParams): Promise<LongTermPromoteResult> {
    const before = await this.readMemorySnapshot("MEMORY.md");
    kaelLogger.info("chat.compact.long_term_promote.started", {
      sessionKey: params.sessionKey,
      requestId: params.requestId ?? null,
    });
    try {
      await this.turns.runTurnWithExcludedMessage({
        sessionKey: params.sessionKey,
        message: buildLongTermPromotionPrompt(),
        requestId: params.requestId ? `${params.requestId}:compact-promote` : undefined,
        context: params.context,
        excludeCurrentMessage: params.currentMessage,
      });
    } catch (error) {
      kaelLogger.warn("chat.compact.long_term_promote.failed", {
        sessionKey: params.sessionKey,
        requestId: params.requestId ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
      return { written: false, reason: "llm_error" };
    }
    const after = await this.readMemorySnapshot("MEMORY.md");
    const wrote = (after.length ?? 0) > (before.length ?? 0);
    kaelLogger.info("chat.compact.long_term_promote.finished", {
      sessionKey: params.sessionKey,
      requestId: params.requestId ?? null,
      wroteLongTerm: wrote,
      beforeLen: before.length ?? 0,
      afterLen: after.length ?? 0,
    });
    return { written: wrote, reason: wrote ? "llm_promote" : "no_change" };
  }

  private async readMemorySnapshot(relPath: string): Promise<{ length: number | null }> {
    try {
      const result = await this.memory.get({ relPath });
      return { length: result.text.length };
    } catch {
      return { length: null };
    }
  }
}
