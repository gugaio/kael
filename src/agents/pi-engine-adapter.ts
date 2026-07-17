import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PiEngineConfig } from "../config.js";
import { ensureDir } from "../infra/fs.js";
import { kaelLogger } from "../infra/logger.js";
import { retry } from "../infra/retry.js";
import { buildPrompt } from "./pi-engine-prompt.js";
import { normalizePiError, PiEngineError } from "./pi-errors.js";
import {
  extractAssistantTextFromSdkMessage,
  getSdkErrorMessage,
  getSdkMessageShape,
  sanitizeForDebug,
} from "./pi-sdk-messages.js";
import { createPiTools } from "./pi-tools.js";
import { ToolLoopGuard } from "./tool-loop-guard.js";
import type {
  AgentEngine,
  EngineOutputArtifact,
  EngineRuntimeTelemetry,
  EngineTurnInput,
  EngineTurnOutput,
} from "./types.js";
import { PiAgentRuntime, type CreatedPiAgent } from "./pi-runtime.js";

export { buildPrompt } from "./pi-engine-prompt.js";
export { extractAssistantTextFromSdkMessage } from "./pi-sdk-messages.js";

type PiAdapterObservabilityConfig = {
  failureDumpDir?: string;
  dumpEnabled?: boolean;
};

type PiToolEvent = {
  phase: "start" | "end";
  tool: string;
  status?: string;
  blocked?: boolean;
  reason?: string;
  summary?: string;
  artifact?: EngineOutputArtifact;
};

type PiTurnAttemptStats = {
  toolCalls: number;
  blockedCalls: number;
  lastBlockedReason: string;
  webEvidence: string[];
  artifacts: EngineOutputArtifact[];
};

export class PiEngineAdapter implements AgentEngine {
  private readonly loopGuard = new ToolLoopGuard();
  private readonly telemetry: EngineRuntimeTelemetry = {
    timeouts: 0,
    toolCallsByName: {},
    blockedCallsByTool: {},
  };

  constructor(
    private readonly cfg: PiEngineConfig,
    private readonly obs: PiAdapterObservabilityConfig = {},
    private readonly runtime: PiAgentRuntime = new PiAgentRuntime(cfg),
  ) {}

  async runTurn(input: EngineTurnInput): Promise<EngineTurnOutput> {
    if (!this.cfg.enabled) {
      throw new PiEngineError({
        message: "Pi engine disabled",
        code: "provider_unavailable",
        retryable: false,
      });
    }

    const turnId = randomUUID();
    let attempt = 0;
    const startedAtMs = Date.now();
    kaelLogger.info("pi.turn.started", {
      turnId,
      requestId: input.requestId ?? null,
      sessionKey: input.sessionKey,
      provider: this.cfg.provider,
      model: this.cfg.model,
    });

    return retry(
      async () => {
        attempt += 1;
        return this.runAttempt(input, {
          turnId,
          attempt,
          startedAtMs,
        });
      },
      this.cfg.retry,
      ({ error }) => normalizePiError(error).retryable,
    );
  }

  getRuntimeTelemetrySnapshot(): EngineRuntimeTelemetry {
    return {
      timeouts: this.telemetry.timeouts,
      toolCallsByName: { ...this.telemetry.toolCallsByName },
      blockedCallsByTool: { ...this.telemetry.blockedCallsByTool },
    };
  }

  private async runAttempt(
    input: EngineTurnInput,
    trace: {
      turnId: string;
      attempt: number;
      startedAtMs: number;
    },
  ): Promise<EngineTurnOutput> {
    const attemptStartedAtMs = Date.now();
    const attemptStats = this.createAttemptStats();
    const { agent, abortController } = this.createSdkAgent(input, {
      turnId: trace.turnId,
      attempt: trace.attempt,
      onToolEvent: (event) => {
        this.recordToolEvent(attemptStats, event);
      },
    });

    return new Promise<EngineTurnOutput>((resolve, reject) => {
      let settled = false;
      let unsubscribe: (() => void) | undefined;
      const eventCounts = new Map<string, number>();

      const registerEvent = (event: unknown): void => {
        if (!event || typeof event !== "object") {
          return;
        }
        const type = (event as { type?: unknown }).type;
        if (typeof type !== "string" || !type.trim()) {
          return;
        }
        eventCounts.set(type, (eventCounts.get(type) ?? 0) + 1);
      };

      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        unsubscribe?.();
        fn();
      };

      const timeout = setTimeout(() => {
        finish(() => {
          abortController.abort(
            new DOMException("Pi turn timed out and was aborted", "AbortError"),
          );
          agent.abort();
          kaelLogger.warn("pi.turn.timeout", {
            turnId: trace.turnId,
            requestId: input.requestId ?? null,
            sessionKey: input.sessionKey,
            provider: this.cfg.provider,
            model: this.cfg.model,
            attempt: trace.attempt,
            toolCalls: attemptStats.toolCalls,
            blockedCalls: attemptStats.blockedCalls,
            blockedReason: attemptStats.lastBlockedReason || null,
            durationMs: Date.now() - attemptStartedAtMs,
          });
          this.telemetry.timeouts += 1;
          reject(this.buildTimeoutError(attemptStats));
        });
      }, this.cfg.timeoutMs);

      const unsub = agent.subscribe((event) => {
        registerEvent(event);
        const typedEvent = event as { type?: unknown; messages?: unknown } | null;
        if (!typedEvent || typedEvent.type !== "agent_end") {
          return;
        }

        finish(() => {
          const errorMessage = getSdkErrorMessage(event);
          if (errorMessage) {
            kaelLogger.error("pi.turn.agent_end_error", {
              turnId: trace.turnId,
              requestId: input.requestId ?? null,
              sessionKey: input.sessionKey,
              provider: this.cfg.provider,
              model: this.cfg.model,
              attempt: trace.attempt,
              durationMs: Date.now() - attemptStartedAtMs,
              eventCounts: Object.fromEntries(eventCounts.entries()),
              sdkError: errorMessage,
            });
            reject(normalizePiError(new Error(`Pi SDK agent error: ${errorMessage}`)));
            return;
          }

          const messages = Array.isArray(typedEvent.messages) ? typedEvent.messages : [];
          const assistant = [...messages]
            .reverse()
            .find((message) => (message as { role?: unknown })?.role === "assistant");

          const text = extractAssistantTextFromSdkMessage(assistant);
          if (!text) {
            const payload = {
              turnId: trace.turnId,
              requestId: input.requestId ?? null,
              sessionKey: input.sessionKey,
              provider: this.cfg.provider,
              model: this.cfg.model,
              attempt: trace.attempt,
              durationMs: Date.now() - attemptStartedAtMs,
              eventCounts: Object.fromEntries(eventCounts.entries()),
              messageCount: messages.length,
              lastMessages: messages.slice(-4).map((msg) => getSdkMessageShape(msg)),
              assistantShapes: messages
                .filter((message) => (message as { role?: unknown })?.role === "assistant")
                .slice(-3)
                .map((message) => getSdkMessageShape(message)),
              agentEndRaw: sanitizeForDebug(event),
            };
            kaelLogger.error("pi.turn.empty_content", payload);
            void this.writeFailureDump(payload);
            reject(
              new PiEngineError({
                message: "Pi SDK returned empty content",
                code: "invalid_response",
                retryable: false,
              }),
            );
            return;
          }

          kaelLogger.info("pi.turn.completed", {
            turnId: trace.turnId,
            requestId: input.requestId ?? null,
            sessionKey: input.sessionKey,
            provider: this.cfg.provider,
            model: this.cfg.model,
            attempt: trace.attempt,
            durationMs: Date.now() - attemptStartedAtMs,
            totalDurationMs: Date.now() - trace.startedAtMs,
            eventCounts: Object.fromEntries(eventCounts.entries()),
            replyChars: text.length,
          });
          resolve({ reply: text, artifacts: attemptStats.artifacts });
        });
      });
      if (typeof unsub === "function") {
        unsubscribe = unsub;
      }

      agent.prompt(buildPrompt(input)).catch((error) => {
        finish(() => {
          const normalized = normalizePiError(error);
          kaelLogger.error("pi.turn.prompt_failed", {
            turnId: trace.turnId,
            requestId: input.requestId ?? null,
            sessionKey: input.sessionKey,
            provider: this.cfg.provider,
            model: this.cfg.model,
            attempt: trace.attempt,
            durationMs: Date.now() - attemptStartedAtMs,
            code: normalized.code,
            retryable: normalized.retryable,
            cause: normalized.message,
          });
          reject(normalized);
        });
      });
    });
  }

  private createAttemptStats(): PiTurnAttemptStats {
    return {
      toolCalls: 0,
      blockedCalls: 0,
      lastBlockedReason: "",
      webEvidence: [],
      artifacts: [],
    };
  }

  private recordToolEvent(stats: PiTurnAttemptStats, event: PiToolEvent): void {
    if (event.phase === "start") {
      stats.toolCalls += 1;
      this.telemetry.toolCallsByName[event.tool] = (this.telemetry.toolCallsByName[event.tool] ?? 0) + 1;
      return;
    }

    if (event.blocked) {
      stats.blockedCalls += 1;
      if (event.reason) {
        stats.lastBlockedReason = event.reason;
      }
      this.telemetry.blockedCallsByTool[event.tool] = (this.telemetry.blockedCallsByTool[event.tool] ?? 0) + 1;
    }

    if (
      event.phase === "end" &&
      typeof event.summary === "string" &&
      event.summary.trim() &&
      (event.tool === "web_search" || event.tool === "web_fetch" || event.tool === "web_research")
    ) {
      const normalized = event.summary.trim();
      if (!stats.webEvidence.includes(normalized)) {
        stats.webEvidence.push(normalized);
      }
      if (stats.webEvidence.length > 5) {
        stats.webEvidence = stats.webEvidence.slice(-5);
      }
    }

    if (event.phase === "end" && event.artifact) {
      stats.artifacts.push(event.artifact);
    }
  }

  private buildTimeoutError(stats: PiTurnAttemptStats): PiEngineError {
    const timedOutWithTools = stats.toolCalls > 0 || stats.blockedCalls > 0;
    return new PiEngineError({
      message: timedOutWithTools
        ? [
            `Pi SDK call timed out after ${stats.toolCalls} tool calls`,
            stats.webEvidence.length > 0 ? `partial_web_evidence: ${stats.webEvidence.join(" || ")}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "Pi SDK call timed out",
      code: "timeout",
      retryable: !timedOutWithTools,
    });
  }

  private createSdkAgent(
    input: EngineTurnInput,
    trace: {
      turnId: string;
      attempt: number;
      onToolEvent: (event: PiToolEvent) => void;
    },
  ): CreatedPiAgent {
    return this.runtime.createAgent({
      systemPrompt: this.cfg.systemPrompt,
      thinkingLevel: "low",
      createTools: (turnSignal) => createPiTools({
          sessionKey: input.sessionKey,
          context: input.context,
          turnSignal,
          loopGuard: this.loopGuard,
          trace: {
            turnId: trace.turnId,
            attempt: trace.attempt,
            requestId: input.requestId,
            goal: input.message,
          },
          budget: {
            maxToolCalls: 24,
            maxExecCalls: 12,
            maxStreamerCalls: 12,
            maxWebFetchCalls: 8,
            maxWebSearchCalls: 5,
            maxWebResearchCalls: 3,
            maxMcpCalls: 6,
            maxBrowserCalls: 12,
            maxBrowserInteractionCalls: 8,
          },
          onToolEvent: trace.onToolEvent,
      }),
    });
  }

  private async writeFailureDump(payload: Record<string, unknown>): Promise<void> {
    if (this.obs.dumpEnabled === false) {
      return;
    }
    const root = this.obs.failureDumpDir?.trim();
    if (!root) {
      return;
    }
    try {
      await ensureDir(root);
      const turnId = typeof payload.turnId === "string" ? payload.turnId : randomUUID();
      const file = path.join(root, `${turnId}.json`);
      await fs.writeFile(
        file,
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            payload,
          },
          null,
          2,
        ),
        "utf-8",
      );
      kaelLogger.info("pi.turn.dump_written", {
        turnId,
        path: file,
      });
    } catch (error) {
      kaelLogger.warn("pi.turn.dump_failed", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
