import type { EngineInboundAttachment, EngineOutputArtifact, EngineToolingNamespaces } from "../engine/types.js";
import { normalizePiError } from "../engine/pi-errors.js";
import type { MemoryService } from "../memory/service.js";
import type { SessionStore } from "../session/store.js";
import type { ShellRuntime } from "../tools/system/shell-tool-service.js";
import type { SessionMessage } from "../types.js";
import { kaelLogger } from "../infra/logger.js";
import { TurnOrchestrator } from "./turn-orchestrator.js";
import { MemoryOrchestrator } from "../memory/orchestrator.js";
import { CommandRouter } from "./command-router.js";
import { ChatRoutingTelemetry, type ChatRoutingTelemetrySnapshot } from "./routing-telemetry.js";
import { createChatOnlyTooling } from "./tooling-factory.js";
import type { MediaRuntimeTelemetry, MediaUnderstandingService } from "../media/service.js";
import type { BrowserRuntimeTelemetry } from "../capabilities/browser/index.js";
import { SkillService, type SkillsRuntimeTelemetry } from "../skills/service.js";

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

function buildStoredUserMessage(message: string, attachments?: EngineInboundAttachment[]): string {
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

export class ChatService {
  private readonly tooling: EngineToolingNamespaces;
  private readonly chatOnlyTooling: EngineToolingNamespaces;
  private readonly memoryOrchestrator: MemoryOrchestrator;
  private readonly commandRouter = new CommandRouter();
  private readonly routingTelemetry = new ChatRoutingTelemetry();
  private readonly skills: SkillService;

  constructor(
    private readonly sessions: SessionStore,
    private readonly shell: ShellRuntime,
    private readonly orchestrator: TurnOrchestrator,
    private readonly media: MediaUnderstandingService,
    memory: MemoryService,
    tooling: EngineToolingNamespaces,
    skills: SkillService,
  ) {
    this.memoryOrchestrator = new MemoryOrchestrator(this.sessions, memory, this.orchestrator);
    this.tooling = tooling;
    this.chatOnlyTooling = createChatOnlyTooling(tooling);
    this.skills = skills;
  }

  async handleMessage(input: {
    sessionKey: string;
    message: string;
    attachments?: EngineInboundAttachment[];
    source?: "api" | "discord" | "email" | "unknown";
    requestId?: string;
  }): Promise<{ user: SessionMessage; assistant: SessionMessage; reply: string; artifacts: EngineOutputArtifact[] }> {
    return this.handleMessageInternal(input, this.tooling, { allowOperationalShortcuts: true });
  }

  async handleMessageChatOnly(input: {
    sessionKey: string;
    message: string;
    attachments?: EngineInboundAttachment[];
    source?: "api" | "discord" | "email" | "unknown";
    requestId?: string;
  }): Promise<{ user: SessionMessage; assistant: SessionMessage; reply: string; artifacts: EngineOutputArtifact[] }> {
    return this.handleMessageInternal(input, this.chatOnlyTooling, { allowOperationalShortcuts: false });
  }

  getRoutingTelemetrySnapshot(): ChatRoutingTelemetrySnapshot {
    return this.routingTelemetry.snapshot();
  }

  getEngineRuntimeTelemetrySnapshot(): {
    timeouts: number;
    toolCallsByName: Record<string, number>;
    blockedCallsByTool: Record<string, number>;
  } {
    return this.orchestrator.getEngineRuntimeTelemetrySnapshot();
  }

  getMediaRuntimeTelemetrySnapshot(): MediaRuntimeTelemetry {
    return this.media.getRuntimeTelemetrySnapshot();
  }

  getBrowserRuntimeTelemetrySnapshot(): BrowserRuntimeTelemetry {
    return this.tooling.browser.browserRuntimeTelemetry();
  }

  getSkillsRuntimeTelemetrySnapshot(): SkillsRuntimeTelemetry {
    return this.skills.getRuntimeTelemetrySnapshot();
  }

  private async handleMessageInternal(
    input: HandleMessageInput,
    tooling: EngineToolingNamespaces,
    opts: { allowOperationalShortcuts: boolean },
  ): Promise<ChatReplyEnvelope> {
    const storedUserMessage = buildStoredUserMessage(input.message, input.attachments);
    let user = await this.sessions.appendMessage(input.sessionKey, "user", storedUserMessage);
    const manualSkillResult = await this.applyManualSkillStage(input, user);
    if ("reply" in manualSkillResult) {
      return manualSkillResult;
    }
    const pipeline = manualSkillResult;

    const compactReply = await this.tryCompactStage(input, tooling, user);
    if (compactReply) {
      return compactReply;
    }

    try {
      const fastPathReply = await this.tryOperationalFastPathStage(input, tooling, opts, user, pipeline);
      if (fastPathReply) {
        return fastPathReply;
      }

      const llmMessage = await this.prepareLlmMessageStage(input, pipeline);
      return this.runLlmTurnStage(input, tooling, user, llmMessage);
    } catch (error) {
      return this.handlePipelineError(input, tooling, storedUserMessage, user, error);
    }
  }

  async getHistory(sessionKey: string, limit = 50): Promise<SessionMessage[]> {
    return this.sessions.getMessages(sessionKey, limit);
  }

  private async handleCompactCommand(input: {
    sessionKey: string;
    currentMessage: string;
    tooling: EngineToolingNamespaces;
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

  private async applyManualSkillStage(
    input: HandleMessageInput,
    user: SessionMessage,
  ): Promise<PipelineState | ChatReplyEnvelope> {
    const skillInvocation = await this.skills.resolveManualInvocation(input.message);
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
      const assistant = await this.sessions.appendMessage(input.sessionKey, "assistant", skillInvocation.reply);
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
    tooling: EngineToolingNamespaces,
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
      tooling,
      requestId: input.requestId,
    });
    const assistant = await this.sessions.appendMessage(input.sessionKey, "assistant", result.reply);
    return {
      user,
      assistant,
      reply: result.reply,
      artifacts: [],
    };
  }

  private async tryOperationalFastPathStage(
    input: HandleMessageInput,
    tooling: EngineToolingNamespaces,
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
      tooling,
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
    const assistant = await this.sessions.appendMessage(input.sessionKey, "assistant", commandRoute.reply);
    return {
      user,
      assistant,
      reply: commandRoute.reply,
      artifacts: [],
    };
  }

  private async prepareLlmMessageStage(input: HandleMessageInput, pipeline: PipelineState): Promise<string> {
    let llmInputMessage = pipeline.llmInputMessage;
    if (!pipeline.skillManualApplied) {
      const preparedSkillTurn = await this.skills.prepareTurnMessage(llmInputMessage, {
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

    const mediaPreprocess = await this.media.preprocess({
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

  private async runLlmTurnStage(
    input: HandleMessageInput,
    tooling: EngineToolingNamespaces,
    user: SessionMessage,
    llmMessage: string,
  ): Promise<ChatReplyEnvelope> {
    await this.memoryOrchestrator.runAutoCompactionWithMemoryFlushIfNeeded({
      sessionKey: input.sessionKey,
      currentMessage: llmMessage,
      tooling,
      requestId: input.requestId,
    });
    this.routingTelemetry.record("llm_turn");
    kaelLogger.info("chat.route.selected", {
      route: "llm_turn",
      sessionKey: input.sessionKey,
      requestId: input.requestId ?? null,
    });
    const turn = await this.orchestrator.runConversationTurn({
      sessionKey: input.sessionKey,
      message: llmMessage,
      attachments: input.attachments,
      requestId: input.requestId,
      tooling,
    });
    const reply = turn.reply;
    const artifacts = turn.artifacts ?? [];
    const assistant = await this.sessions.appendMessage(input.sessionKey, "assistant", reply);
    return {
      user,
      assistant,
      reply,
      artifacts,
    };
  }

  private async handlePipelineError(
    input: HandleMessageInput,
    tooling: EngineToolingNamespaces,
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
      const sessions = await this.shell.process({
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
      const assistant = await this.sessions.appendMessage(input.sessionKey, "assistant", reply);
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

    await this.sessions.resetSession(input.sessionKey);
    const resetUser = await this.sessions.appendMessage(input.sessionKey, "user", storedUserMessage);
    const turn = await this.orchestrator.runConversationTurn({
      sessionKey: input.sessionKey,
      message: input.message,
      attachments: input.attachments,
      requestId: input.requestId,
      tooling,
    });
    const assistant = await this.sessions.appendMessage(input.sessionKey, "assistant", turn.reply);

    return {
      user: resetUser,
      assistant,
      reply: turn.reply,
      artifacts: turn.artifacts ?? [],
    };
  }
}
