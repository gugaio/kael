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
import type { BrowserRuntimeTelemetry } from "../runtime/browser/index.js";
import { extractProjectMention, type ProjectContextService } from "../projects/service.js";
import { SkillService, type SkillsRuntimeTelemetry } from "../skills/service.js";

const PROJECT_KNOWLEDGE_MAX_NOTES = 2;
const PROJECT_KNOWLEDGE_MIN_SCORE = 10;
const PROJECT_CONTEXT_MAX_CHARS = 1400;

function shouldResetSessionOnEngineError(error: unknown): boolean {
  const normalized = normalizePiError(error);
  return normalized.code === "invalid_response" || normalized.code === "unknown";
}

function isSlashLikeCommand(message: string): boolean {
  return message.trimStart().startsWith("/");
}

function looksLikeProjectKnowledgeQuestion(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized || normalized.length < 12 || isSlashLikeCommand(normalized)) {
    return false;
  }
  const questionLike =
    normalized.includes("?") ||
    /\b(como|onde|qual|quais|porque|por que|de onde|em qual|what|where|why|how)\b/.test(normalized);
  if (!questionLike) {
    return false;
  }
  return /\b(android|ios|backend|frontend|web|player|api|app|mobile|projeto|param|parametro|header|payload|request|endpoint|contrato)\b/.test(
    normalized,
  );
}

function buildProjectDocumentsContextBlock(
  docs: Array<{
    project: string;
    path: string;
    title: string;
    description: string;
    updatedAt: string;
    content: string;
  }>,
): string {
  const lines = [
    "[project_documents_context]",
    "Use estes documentos do project space apenas se forem relevantes para responder a pergunta atual.",
  ];

  for (const [index, doc] of docs.entries()) {
    lines.push(
      "",
      `${index + 1}. project=${doc.project} path=${doc.path} updatedAt=${doc.updatedAt}`,
      `title=${doc.title}`,
      `description=${doc.description}`,
      doc.content.trim().slice(0, PROJECT_CONTEXT_MAX_CHARS),
    );
  }

  return lines.join("\n");
}

function buildProjectOverviewContextBlock(project: { name: string; content: string; filePath: string }): string {
  const trimmedContent = project.content.trim().slice(0, PROJECT_CONTEXT_MAX_CHARS);
  return [
    "[project_context]",
    `project=${project.name}`,
    `file=${project.filePath}`,
    "Use este contexto do projeto quando ele ajudar a interpretar a pergunta atual.",
    trimmedContent,
  ].join("\n");
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
  private readonly projects: ProjectContextService;

  constructor(
    private readonly sessions: SessionStore,
    private readonly shell: ShellRuntime,
    private readonly orchestrator: TurnOrchestrator,
    private readonly media: MediaUnderstandingService,
    memory: MemoryService,
    tooling: EngineToolingNamespaces,
    projects: ProjectContextService,
    skills: SkillService,
  ) {
    this.memoryOrchestrator = new MemoryOrchestrator(this.sessions, memory, this.orchestrator);
    this.tooling = tooling;
    this.chatOnlyTooling = createChatOnlyTooling(tooling);
    this.projects = projects;
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
    const projectHint = extractProjectMention(input.message);
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

    const projectContextBlocks = await this.buildProjectContextBlocks(input, llmInputMessage, projectHint?.projectName);
    if (projectContextBlocks.length > 0) {
      llmInputMessage = `${llmInputMessage}\n\n${projectContextBlocks.join("\n\n")}`;
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

  private async buildProjectContextBlocks(
    input: HandleMessageInput,
    llmInputMessage: string,
    projectName?: string,
  ): Promise<string[]> {
    const blocks: string[] = [];
    if (!projectName && !looksLikeProjectKnowledgeQuestion(input.message)) {
      return blocks;
    }

    try {
      if (projectName) {
        const project = await this.projects.ensureProject(projectName);
        blocks.push(buildProjectOverviewContextBlock(project));
      }
      const results = await this.projects.search({
        query: input.message,
        ...(projectName ? { project: projectName } : {}),
        maxResults: PROJECT_KNOWLEDGE_MAX_NOTES,
      });
      const strongMatches = results
        .filter((item) => item.score >= PROJECT_KNOWLEDGE_MIN_SCORE)
        .slice(0, PROJECT_KNOWLEDGE_MAX_NOTES);
      if (strongMatches.length === 0) {
        return blocks;
      }

      const docs = (
        await Promise.all(
          strongMatches.map((item) => this.projects.getDocument(item.project, item.path)),
        )
      ).filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (docs.length === 0) {
        return blocks;
      }

      kaelLogger.info("chat.project_documents.context_applied", {
        sessionKey: input.sessionKey,
        requestId: input.requestId ?? null,
        projectName: projectName ?? null,
        docs: docs.map((item) => `${item.project}/${item.path}`),
        query: input.message,
        llmChars: llmInputMessage.length,
      });
      blocks.push(buildProjectDocumentsContextBlock(docs));
      return blocks;
    } catch (error) {
      kaelLogger.warn("chat.project_documents.context_failed", {
        sessionKey: input.sessionKey,
        requestId: input.requestId ?? null,
        projectName: projectName ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
      return blocks;
    }
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
