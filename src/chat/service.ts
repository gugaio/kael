import type { EngineInboundAttachment, EngineOutputArtifact } from "../agents/types.js";
import { normalizePiError } from "../agents/pi-errors.js";
import type { SessionMessage } from "../types.js";
import { kaelLogger } from "../infra/logger.js";
import { MemoryOrchestrator } from "../memory/orchestrator.js";
import { CommandRouter } from "./command-router.js";
import { ChatRoutingTelemetry, type ChatRoutingTelemetrySnapshot } from "./routing-telemetry.js";
import type { AgentContext } from "../agents/context.js";
import type { MediaRuntimeTelemetry } from "../media/service.js";
import type { BrowserRuntimeTelemetry } from "../runtime/browser/index.js";
import type { SkillsRuntimeTelemetry } from "../skills/service.js";

function shouldResetSessionOnEngineError(error: unknown): boolean {
  const normalized = normalizePiError(error);
  return normalized.code === "invalid_response" || normalized.code === "unknown";
}

function extractPartialWebEvidence(message: string): string[] {
  const marker = "partial_web_evidence:";
  const idx = message.indexOf(marker);
  if (idx < 0) {
    return [];
  }
  const raw = message.slice(idx + marker.length).trim();
  if (!raw) {
    return [];
  }
  return raw
    .split("||")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function summarizeAttachmentForTranscript(attachment: EngineInboundAttachment): string {
  const mime = attachment.mimeType?.trim() || "unknown";
  const name = attachment.fileName?.trim() || "sem_nome";
  return `- ${attachment.kind}: ${name} (${mime})`;
}

function appendAttachmentSummaryToMessage(message: string, attachments?: EngineInboundAttachment[]): string {
  if (!attachments || attachments.length === 0) {
    return message;
  }
  const lines = [
    message,
    "",
    "[attachments]",
    ...attachments.map((attachment) => summarizeAttachmentForTranscript(attachment)),
  ];
  return lines.join("\n");
}

type HandleMessageInput = {
  sessionKey: string;
  message: string;
  attachments?: EngineInboundAttachment[];
  source?: "api" | "discord" | "email" | "unknown";
  requestId?: string;
  allowOperationalShortcuts?: boolean;
};

type ChatReplyEnvelope = {
  user: SessionMessage;
  assistant: SessionMessage;
  reply: string;
  artifacts: EngineOutputArtifact[];
};

type PipelineState = {
  llmInputMessage: string;
  skipOperationalFastPath: boolean;
  skillManualApplied: boolean;
};

type PreLlmDeterministicRouteResult =
  | { reply: ChatReplyEnvelope }
  | { pipeline: PipelineState };

export class ChatService {
  private readonly memoryOrchestrator: MemoryOrchestrator;
  private readonly commandRouter = new CommandRouter();
  private readonly routingTelemetry = new ChatRoutingTelemetry();

  constructor(private readonly context: AgentContext) {
    this.memoryOrchestrator = new MemoryOrchestrator(
      context.core.sessions,
      context.services.memory,
      context.core.orchestrator,
    );
  }

  async handleMessage(input: {
    sessionKey: string;
    message: string;
    attachments?: EngineInboundAttachment[];
    source?: "api" | "discord" | "email" | "unknown";
    requestId?: string;
    allowOperationalShortcuts?: boolean;
  }): Promise<{ user: SessionMessage; assistant: SessionMessage; reply: string; artifacts: EngineOutputArtifact[] }> {
    return this.handleMessageInternal(input, {
      allowOperationalShortcuts: input.allowOperationalShortcuts ?? true,
    });
  }

  getRoutingTelemetrySnapshot(): ChatRoutingTelemetrySnapshot {
    return this.routingTelemetry.snapshot();
  }

  getEngineRuntimeTelemetrySnapshot(): {
    timeouts: number;
    toolCallsByName: Record<string, number>;
    blockedCallsByTool: Record<string, number>;
  } {
    return this.context.core.orchestrator.getEngineRuntimeTelemetrySnapshot();
  }

  getMediaRuntimeTelemetrySnapshot(): MediaRuntimeTelemetry {
    return this.context.services.media.getRuntimeTelemetrySnapshot();
  }

  getBrowserRuntimeTelemetrySnapshot(): BrowserRuntimeTelemetry {
    return this.context.runtimes.browser.getRuntimeTelemetrySnapshot();
  }

  getSkillsRuntimeTelemetrySnapshot(): SkillsRuntimeTelemetry {
    return this.context.services.skills.getRuntimeTelemetrySnapshot();
  }

  private async handleMessageInternal(
    input: HandleMessageInput,
    opts: { allowOperationalShortcuts: boolean },
  ): Promise<ChatReplyEnvelope> {
    const userMessage = appendAttachmentSummaryToMessage(input.message, input.attachments);
    let user = await this.context.core.sessions.appendMessage(input.sessionKey, "user", userMessage);

    try {
      const deterministicRoute = await this.tryDeterministicRoute(input, opts, user);
      if ("reply" in deterministicRoute) {
        return deterministicRoute.reply;
      }

      const llmMessage = await this.preProcessMessage(input, deterministicRoute.pipeline);
      return this.runTurn(input, user, llmMessage);
    } catch (error) {
      return this.handlePipelineError(input, userMessage, user, error);
    }
  }

  async getHistory(sessionKey: string, limit = 50): Promise<SessionMessage[]> {
    return this.context.core.sessions.getMessages(sessionKey, limit);
  }

  private async handleCompactCommand(input: {
    sessionKey: string;
    currentMessage: string;
    context: AgentContext;
    requestId?: string;
  }): Promise<{ reply: string }> {
    const { flush, promote, compaction } = await this.memoryOrchestrator.runManualCompact(input);

    const lines = [
      "Compactacao manual executada.",
      `Daily flush: ${flush.written ? "ok" : "skip"}`,
      flush.path ? `memory_path=${flush.path}` : "",
      flush.written ? `memory_msgs=${flush.includedMessages}` : "",
      flush.reason ? `memory_reason=${flush.reason}` : "",
      `long_term_promote: ${promote.written ? "ok" : "skip"}`,
      promote.reason ? `long_term_reason=${promote.reason}` : "",
      `compaction: ${compaction.compacted ? "ok" : "skip"}`,
      `compaction_reason=${compaction.reason}`,
      `compaction_total_messages=${compaction.totalMessages}`,
      `compaction_total_chars=${compaction.totalChars}`,
      compaction.compacted ? `compaction_summarized_messages=${compaction.summarizedMessages}` : "",
    ].filter(Boolean);

    return { reply: lines.join("\n") };
  }

  private async tryDeterministicRoute(
    input: HandleMessageInput,
    opts: { allowOperationalShortcuts: boolean },
    user: SessionMessage,
  ): Promise<PreLlmDeterministicRouteResult> {
    const manualSkillResult = await this.applyManualSkillStage(input, user);
    if ("reply" in manualSkillResult) {
      return { reply: manualSkillResult };
    }
    const pipeline = manualSkillResult;

    const compactReply = await this.tryCompactStage(input, user);
    if (compactReply) {
      return { reply: compactReply };
    }

    const fastPathReply = await this.tryOperationalFastPathStage(input, opts, user, pipeline);
    if (fastPathReply) {
      return { reply: fastPathReply };
    }

    return { pipeline };
  }

  private async applyManualSkillStage(
    input: HandleMessageInput,
    user: SessionMessage,
  ): Promise<PipelineState | ChatReplyEnvelope> {
    const skillInvocation = await this.context.services.skills.resolveManualInvocation(input.message);
    if (!skillInvocation.matched) {
      return {
        llmInputMessage: input.message,
        skipOperationalFastPath: false,
        skillManualApplied: false,
      };
    }
    if (skillInvocation.blocked) {
      this.routingTelemetry.record("fast_path");
      kaelLogger.info("chat.route.selected", {
        route: "fast_path",
        sessionKey: input.sessionKey,
        requestId: input.requestId ?? null,
        reason: "skill_manual_blocked",
        skillName: skillInvocation.skillName,
      });
      const assistant = await this.context.core.sessions.appendMessage(input.sessionKey, "assistant", skillInvocation.reply);
      return {
        user,
        assistant,
        reply: skillInvocation.reply,
        artifacts: [],
      };
    }
    kaelLogger.info("chat.skill.manual_invocation", {
      sessionKey: input.sessionKey,
      requestId: input.requestId ?? null,
      skillName: skillInvocation.skillName,
    });
    return {
      llmInputMessage: skillInvocation.promptMessage,
      skipOperationalFastPath: true,
      skillManualApplied: true,
    };
  }

  private async tryCompactStage(
    input: HandleMessageInput,
    user: SessionMessage,
  ): Promise<ChatReplyEnvelope | null> {
    if (!this.memoryOrchestrator.isCompactCommand(input.message)) {
      return null;
    }
    this.routingTelemetry.record("compact");
    kaelLogger.info("chat.route.selected", {
      route: "compact",
      sessionKey: input.sessionKey,
      requestId: input.requestId ?? null,
    });
    const result = await this.handleCompactCommand({
      sessionKey: input.sessionKey,
      currentMessage: input.message,
      context: this.context,
      requestId: input.requestId,
    });
    const assistant = await this.context.core.sessions.appendMessage(input.sessionKey, "assistant", result.reply);
    return {
      user,
      assistant,
      reply: result.reply,
      artifacts: [],
    };
  }

  private async tryOperationalFastPathStage(
    input: HandleMessageInput,
    opts: { allowOperationalShortcuts: boolean },
    user: SessionMessage,
    pipeline: PipelineState,
  ): Promise<ChatReplyEnvelope | null> {
    if (pipeline.skipOperationalFastPath) {
      return null;
    }
    const commandRoute = await this.commandRouter.tryRoute({
      sessionKey: input.sessionKey,
      message: input.message,
      requestId: input.requestId,
      context: this.context,
      allowOperationalShortcuts: opts.allowOperationalShortcuts,
    });
    if (!commandRoute.handled) {
      return null;
    }
    this.routingTelemetry.record("fast_path");
    kaelLogger.info("chat.route.selected", {
      route: "fast_path",
      sessionKey: input.sessionKey,
      requestId: input.requestId ?? null,
    });
    const assistant = await this.context.core.sessions.appendMessage(input.sessionKey, "assistant", commandRoute.reply);
    return {
      user,
      assistant,
      reply: commandRoute.reply,
      artifacts: [],
    };
  }

  private async preProcessMessage(input: HandleMessageInput, pipeline: PipelineState): Promise<string> {
    let llmInputMessage = pipeline.llmInputMessage;
    if (!pipeline.skillManualApplied) {
      const preparedSkillTurn = await this.context.services.skills.prepareTurnMessage(llmInputMessage, {
        sessionKey: input.sessionKey,
      });
      llmInputMessage = preparedSkillTurn.promptMessage;
      if (preparedSkillTurn.autoAppliedSkillName) {
        kaelLogger.info("chat.skill.auto_invocation", {
          sessionKey: input.sessionKey,
          requestId: input.requestId ?? null,
          skillName: preparedSkillTurn.autoAppliedSkillName,
        });
      }
    }

    const mediaPreprocess = await this.context.services.media.preprocess({
      sessionKey: input.sessionKey,
      message: llmInputMessage,
      attachments: input.attachments,
      source: input.source ?? "unknown",
      requestId: input.requestId,
    });
    if (mediaPreprocess.applied) {
      kaelLogger.info("media.preprocess.applied", {
        sessionKey: input.sessionKey,
        requestId: input.requestId ?? null,
        details: mediaPreprocess.details,
      });
    }
    return mediaPreprocess.message;
  }

  private async runTurn(
    input: HandleMessageInput,
    user: SessionMessage,
    llmMessage: string,
  ): Promise<ChatReplyEnvelope> {
    await this.memoryOrchestrator.runAutoCompactionWithMemoryFlushIfNeeded({
      sessionKey: input.sessionKey,
      currentMessage: llmMessage,
      context: this.context,
      requestId: input.requestId,
    });
    this.routingTelemetry.record("llm_turn");
    kaelLogger.info("chat.route.selected", {
      route: "llm_turn",
      sessionKey: input.sessionKey,
      requestId: input.requestId ?? null,
    });
    const turn = await this.context.core.orchestrator.runConversationTurn({
      sessionKey: input.sessionKey,
      message: llmMessage,
      attachments: input.attachments,
      requestId: input.requestId,
      context: this.context,
    });
    const reply = turn.reply;
    const artifacts = turn.artifacts ?? [];
    const assistant = await this.context.core.sessions.appendMessage(input.sessionKey, "assistant", reply);
    return {
      user,
      assistant,
      reply,
      artifacts,
    };
  }

  private async handlePipelineError(
    input: HandleMessageInput,
    storedUserMessage: string,
    user: SessionMessage,
    error: unknown,
  ): Promise<ChatReplyEnvelope> {
    const normalized = normalizePiError(error);
    if (normalized.code === "timeout") {
      const partialEvidence = extractPartialWebEvidence(normalized.message);
      const cleanReason = normalized.message
        .split("\n")
        .find((line) => !line.includes("partial_web_evidence:"))
        ?.trim();
      const sessions = await this.context.runtimes.shell.process({
        sessionKey: input.sessionKey,
        action: "list",
      });
      const recent = (sessions.sessions ?? []).slice(-3);
      const lines = recent.map((item) => {
        const exit = item.exitCode == null ? "n/a" : String(item.exitCode);
        return `- ${item.status} (exit=${exit}) :: ${item.command}`;
      });
      const reply = [
        "A execucao demorou demais e foi interrompida para evitar loop de ferramentas.",
        cleanReason ? `Motivo: ${cleanReason}` : "",
        partialEvidence.length > 0 ? "Evidencias parciais coletadas antes do timeout:" : "",
        ...partialEvidence.map((item) => `- ${item}`),
        lines.length > 0 ? "Ultimas execucoes shell observadas:" : "",
        ...lines,
        "Se quiser, posso continuar de forma mais objetiva com um comando por vez.",
      ]
        .filter(Boolean)
        .join("\n");
      const assistant = await this.context.core.sessions.appendMessage(input.sessionKey, "assistant", reply);
      return {
        user,
        assistant,
        reply,
        artifacts: [],
      };
    }

    if (!shouldResetSessionOnEngineError(error)) {
      throw error;
    }

    await this.context.core.sessions.resetSession(input.sessionKey);
    const resetUser = await this.context.core.sessions.appendMessage(input.sessionKey, "user", storedUserMessage);
    const turn = await this.context.core.orchestrator.runConversationTurn({
      sessionKey: input.sessionKey,
      message: input.message,
      attachments: input.attachments,
      requestId: input.requestId,
      context: this.context,
    });
    const assistant = await this.context.core.sessions.appendMessage(input.sessionKey, "assistant", turn.reply);

    return {
      user: resetUser,
      assistant,
      reply: turn.reply,
      artifacts: turn.artifacts ?? [],
    };
  }
}
