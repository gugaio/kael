import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { PiEngineConfig } from "../config.js";
import { ensureDir } from "../infra/fs.js";
import { kaelLogger } from "../infra/logger.js";
import { retry } from "../infra/retry.js";
import { normalizePiError, PiEngineError } from "./pi-errors.js";
import { createPiShellTools } from "./pi-tools.js";
import { ToolLoopGuard } from "./tool-loop-guard.js";
import type {
  AgentEngine,
  EngineOutputArtifact,
  EngineRuntimeTelemetry,
  EngineTurnInput,
  EngineTurnOutput,
} from "./types.js";

type PiAgentLike = {
  prompt: (prompt: string) => Promise<void>;
  abort: () => void;
  subscribe: (listener: (event: unknown) => void) => (() => void) | void;
};

type CreatedPiAgent = {
  agent: PiAgentLike;
  abortController: AbortController;
};

type PiAdapterObservabilityConfig = {
  failureDumpDir?: string;
  dumpEnabled?: boolean;
};

type SdkMessageShape = {
  role: string | null;
  contentType: "string" | "array" | "object" | "null" | "unknown";
  blockTypes?: string[];
  textPreview?: string;
};

function isSelfKnowledgeQuestion(message: string): boolean {
  const text = message.toLowerCase();
  const tokens = [
    "framework",
    "agentic",
    "loop",
    "arquitetura",
    "stack",
    "pi-agent-core",
    "fastify",
    "como voce funciona",
    "internamente",
    "qual engine",
    "que agente code",
    "seu codigo",
    "seus arquivos",
  ];
  return tokens.some((token) => text.includes(token));
}

function isOperationalExecutionRequest(message: string): boolean {
  const text = message.toLowerCase();
  const tokens = [
    "executa",
    "execute",
    "roda",
    "rodar",
    "abre",
    "abrir",
    "toca",
    "tocar",
    "run ",
    "shell",
    "bash",
    "ffprobe",
    "ffmpeg",
  ];
  return tokens.some((token) => text.includes(token));
}

function isMemoryRecallQuestion(message: string): boolean {
  const text = message.toLowerCase();
  const lexicalTriggers = [
    "meu ",
    "minha ",
    "meus ",
    "minhas ",
    "lembra",
    "lembrar",
    "como combinamos",
    "qual era",
    "qual é meu",
    "qual e meu",
    "qual é minha",
    "qual e minha",
    "time",
    "preferencia",
    "preferência",
    "gosto",
    "projeto",
    "decisao",
    "decisão",
    "historico",
    "histórico",
    "contexto anterior",
  ];
  return lexicalTriggers.some((token) => text.includes(token));
}

function buildMemoryRecallInstruction(currentMessage: string): string[] {
  return [
    "Pergunta com alta chance de depender de memoria detectada.",
    "Antes de responder, siga obrigatoriamente este fluxo de recall:",
    "1) Chame memory_search com uma consulta curta baseada na mensagem atual.",
    "2) Se houver resultado relevante, chame memory_get no path candidato para confirmar o texto fonte.",
    "3) Responda com base no que foi encontrado; nao invente fatos ausentes.",
    "4) Se nao achar evidencia suficiente, diga explicitamente que nao encontrou na memoria.",
    "Exemplos classicos de recall: 'qual meu time?', 'qual minha preferencia?', 'o que combinamos antes?'.",
    `Consulta sugerida para memory_search: "${currentMessage.slice(0, 140)}"`,
    "",
  ];
}

function buildWebToolingDisciplineInstruction(): string[] {
  return [
    "Disciplina obrigatoria para pesquisa web:",
    "1) Se a pergunta for aberta (resumo/destaques/estado atual), prefira web_research em vez de varias chamadas manuais.",
    "2) Evite repetir web_search em cadeia para cada manchete; busque e sintetize com o que ja tem.",
    "3) Se qualquer tool retornar blocked=true (budget/loop), pare de chamar tools e entregue resposta best-effort com evidencias coletadas.",
    "",
  ];
}

function isRuntimeStateQuestion(message: string): boolean {
  const text = message.toLowerCase();
  const triggers = [
    "ultimo job",
    "último job",
    "jobs",
    "transcode",
    "hls",
    "capture",
    "probe",
    "status do job",
    "log do job",
    "plano",
    "planos",
    "status do plano",
    "etapa do plano",
  ];
  return triggers.some((token) => text.includes(token));
}

function buildRuntimeStateInstruction(): string[] {
  return [
    "Pergunta sobre estado historico de jobs/planos detectada.",
    "Priorize tools de estado antes de shell/exec:",
    "1) Para jobs: use jobs_list, jobs_get e jobs_log_tail.",
    "2) Para planos: use plan_list e plan_get.",
    "3) So use exec/process se as tools de estado nao forem suficientes.",
    "",
  ];
}

export function buildPrompt(input: EngineTurnInput): string {
  const context = input.contextMessages ?? [];
  const needsMemoryRecall = isMemoryRecallQuestion(input.message);
  if (context.length === 0) {
    const leadingInstructions: string[] = [];
    if (needsMemoryRecall) {
      leadingInstructions.push(...buildMemoryRecallInstruction(input.message));
    }
    if (isSelfKnowledgeQuestion(input.message)) {
      leadingInstructions.push(
        "Pergunta sobre o proprio Kael detectada.",
        "Antes de responder, investigue o workspace com workspace_search e workspace_read e responda com evidencias (arquivo:linha).",
        "",
      );
    }
    if (isRuntimeStateQuestion(input.message)) {
      leadingInstructions.push(...buildRuntimeStateInstruction());
    }
    leadingInstructions.push(...buildWebToolingDisciplineInstruction());
    if (leadingInstructions.length === 0) {
      return input.message;
    }
    return [...leadingInstructions, "Mensagem atual do usuario:", input.message].join("\n");
  }

  const serializedContext = context
    .filter((item) => item.content.trim().length > 0)
    .map((item) => `[${item.role}] ${item.content}`)
    .join("\n");

  return [
    "Contexto recente da conversa (ordem cronologica):",
    serializedContext,
    "",
    ...(isSelfKnowledgeQuestion(input.message)
      ? [
          "Pergunta sobre o proprio Kael detectada.",
          "Antes de responder, investigue o workspace com workspace_search e workspace_read e responda com evidencias (arquivo:linha).",
          "",
        ]
      : []),
    ...(isRuntimeStateQuestion(input.message) ? buildRuntimeStateInstruction() : []),
    ...buildWebToolingDisciplineInstruction(),
    ...(needsMemoryRecall ? buildMemoryRecallInstruction(input.message) : []),
    "Instrucao critica: responda a MENSAGEM ATUAL do usuario. Nao continue tarefas antigas sem pedido explicito.",
    ...(isOperationalExecutionRequest(input.message)
      ? [
          "Instrucao operacional: o usuario pediu acao real. Use tools (exec/process) para executar e validar.",
          "Nao responda apenas com comando textual ou slash command sem executar.",
          "Ao gerar scripts Python em exec, use 'python3' (nao use 'python').",
        ]
      : []),
    "",
    "Mensagem atual do usuario:",
    input.message,
  ].join("\n");
}

export function extractAssistantTextFromSdkMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const directContent = (message as { content?: unknown }).content;
  if (typeof directContent === "string" && directContent.trim()) {
    return directContent.trim();
  }

  if (Array.isArray(directContent)) {
    const blocks = directContent.filter((block): block is { type?: unknown; text?: unknown } => {
      return Boolean(block && typeof block === "object");
    });

    const preferred = blocks
      .filter((block) => {
        const type = typeof block.type === "string" ? block.type.toLowerCase() : "";
        if (!type) {
          return true;
        }
        if (type.includes("input")) {
          return false;
        }
        if (type.includes("tool") || type.includes("reasoning")) {
          return false;
        }
        return type.includes("output") || type.includes("assistant") || type === "text";
      })
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("")
      .trim();
    if (preferred) {
      return preferred;
    }

    const fallback = blocks
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("")
      .trim();
    if (fallback) {
      return fallback;
    }
  }

  return null;
}

function asSdkErrorMessage(event: unknown): string | null {
  if (!event || typeof event !== "object") {
    return null;
  }
  const value = (event as { errorMessage?: unknown }).errorMessage;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeForDebug(value: unknown, depth = 0): unknown {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 800 ? `${value.slice(0, 800)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth >= 4) {
    return "[max-depth]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 16).map((item) => sanitizeForDebug(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[key] = sanitizeForDebug(inner, depth + 1);
    }
    return out;
  }
  return String(value);
}

function messageShape(message: unknown): SdkMessageShape {
  if (!message || typeof message !== "object") {
    return { role: null, contentType: "null" };
  }
  const role = typeof (message as { role?: unknown }).role === "string" ? (message as { role: string }).role : null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return {
      role,
      contentType: "string",
      textPreview: content.slice(0, 240),
    };
  }
  if (Array.isArray(content)) {
    const blocks = content.filter((block) => block && typeof block === "object");
    const blockTypes = blocks
      .map((block) => {
        const raw = (block as { type?: unknown }).type;
        return typeof raw === "string" ? raw : "unknown";
      })
      .slice(0, 20);
    const preview = blocks
      .map((block) => {
        const raw = (block as { text?: unknown; content?: unknown }).text;
        if (typeof raw === "string" && raw.trim()) {
          return raw.trim();
        }
        const nested = (block as { content?: unknown }).content;
        return typeof nested === "string" ? nested : "";
      })
      .filter((item) => item.length > 0)
      .join(" ")
      .slice(0, 240);
    return {
      role,
      contentType: "array",
      blockTypes,
      textPreview: preview || undefined,
    };
  }
  if (content && typeof content === "object") {
    return {
      role,
      contentType: "object",
      textPreview: JSON.stringify(sanitizeForDebug(content)).slice(0, 240),
    };
  }
  return {
    role,
    contentType: content == null ? "null" : "unknown",
  };
}

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
        const attemptStartedAtMs = Date.now();
        const attemptStats = {
          toolCalls: 0,
          blockedCalls: 0,
          lastBlockedReason: "",
          webEvidence: [] as string[],
          artifacts: [] as EngineOutputArtifact[],
        };
        const { agent, abortController } = this.createSdkAgent(input, {
          turnId,
          attempt,
          onToolEvent: (event) => {
            if (event.phase === "start") {
              attemptStats.toolCalls += 1;
              this.telemetry.toolCallsByName[event.tool] = (this.telemetry.toolCallsByName[event.tool] ?? 0) + 1;
              return;
            }
            if (event.blocked) {
              attemptStats.blockedCalls += 1;
              if (event.reason) {
                attemptStats.lastBlockedReason = event.reason;
              }
              this.telemetry.blockedCallsByTool[event.tool] =
                (this.telemetry.blockedCallsByTool[event.tool] ?? 0) + 1;
            }
            if (
              event.phase === "end" &&
              typeof event.summary === "string" &&
              event.summary.trim() &&
              (event.tool === "web_search" || event.tool === "web_fetch" || event.tool === "web_research")
            ) {
              const normalized = event.summary.trim();
              if (!attemptStats.webEvidence.includes(normalized)) {
                attemptStats.webEvidence.push(normalized);
              }
              if (attemptStats.webEvidence.length > 5) {
                attemptStats.webEvidence = attemptStats.webEvidence.slice(-5);
              }
            }
            if (event.phase === "end" && event.artifact) {
              attemptStats.artifacts.push(event.artifact);
            }
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
              const timedOutWithTools = attemptStats.toolCalls > 0 || attemptStats.blockedCalls > 0;
              kaelLogger.warn("pi.turn.timeout", {
                turnId,
                requestId: input.requestId ?? null,
                sessionKey: input.sessionKey,
                provider: this.cfg.provider,
                model: this.cfg.model,
                attempt,
                toolCalls: attemptStats.toolCalls,
                blockedCalls: attemptStats.blockedCalls,
                blockedReason: attemptStats.lastBlockedReason || null,
                durationMs: Date.now() - attemptStartedAtMs,
              });
              this.telemetry.timeouts += 1;
              reject(
                new PiEngineError({
                  message: timedOutWithTools
                    ? [
                        `Pi SDK call timed out after ${attemptStats.toolCalls} tool calls`,
                        attemptStats.webEvidence.length > 0
                          ? `partial_web_evidence: ${attemptStats.webEvidence.join(" || ")}`
                          : "",
                      ]
                        .filter(Boolean)
                        .join("\n")
                    : "Pi SDK call timed out",
                  code: "timeout",
                  retryable: !timedOutWithTools,
                }),
              );
            });
          }, this.cfg.timeoutMs);

          const unsub = agent.subscribe((event) => {
            registerEvent(event);
            const typedEvent = event as { type?: unknown; messages?: unknown } | null;
            if (!typedEvent || typedEvent.type !== "agent_end") {
              return;
            }

            finish(() => {
              const errorMessage = asSdkErrorMessage(event);
              if (errorMessage) {
                kaelLogger.error("pi.turn.agent_end_error", {
                  turnId,
                  requestId: input.requestId ?? null,
                  sessionKey: input.sessionKey,
                  provider: this.cfg.provider,
                  model: this.cfg.model,
                  attempt,
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
                const assistantShapes = messages
                  .filter((message) => (message as { role?: unknown })?.role === "assistant")
                  .slice(-3)
                  .map((message) => messageShape(message));
                const payload = {
                  turnId,
                  requestId: input.requestId ?? null,
                  sessionKey: input.sessionKey,
                  provider: this.cfg.provider,
                  model: this.cfg.model,
                  attempt,
                  durationMs: Date.now() - attemptStartedAtMs,
                  eventCounts: Object.fromEntries(eventCounts.entries()),
                  messageCount: messages.length,
                  lastMessages: messages.slice(-4).map((msg) => messageShape(msg)),
                  assistantShapes,
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
                turnId,
                requestId: input.requestId ?? null,
                sessionKey: input.sessionKey,
                provider: this.cfg.provider,
                model: this.cfg.model,
                attempt,
                durationMs: Date.now() - attemptStartedAtMs,
                totalDurationMs: Date.now() - startedAtMs,
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
                turnId,
                requestId: input.requestId ?? null,
                sessionKey: input.sessionKey,
                provider: this.cfg.provider,
                model: this.cfg.model,
                attempt,
                durationMs: Date.now() - attemptStartedAtMs,
                code: normalized.code,
                retryable: normalized.retryable,
                cause: normalized.message,
              });
              reject(normalized);
            });
          });
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

  private createSdkAgent(
    input: EngineTurnInput,
    trace: {
      turnId: string;
      attempt: number;
      onToolEvent: (event: {
        phase: "start" | "end";
        tool: string;
        status?: string;
        blocked?: boolean;
        reason?: string;
        summary?: string;
        artifact?: EngineOutputArtifact;
      }) => void;
    },
  ): CreatedPiAgent {
    const model = getModel(this.cfg.provider as never, this.cfg.model);
    if (!model) {
      throw new PiEngineError({
        message: `Model not found for provider=${this.cfg.provider} model=${this.cfg.model}`,
        code: "provider_unavailable",
        retryable: false,
      });
    }
    const abortController = new AbortController();
    const agent = new Agent({
      initialState: {
        systemPrompt: this.cfg.systemPrompt,
        model,
        thinkingLevel: "low",
        tools: createPiShellTools({
          sessionKey: input.sessionKey,
          tooling: input.tooling,
          turnSignal: abortController.signal,
          loopGuard: this.loopGuard,
          trace: {
            turnId: trace.turnId,
            attempt: trace.attempt,
            requestId: input.requestId,
            goal: input.message,
          },
          budget: {
            maxToolCalls: 12,
            maxExecCalls: 6,
            maxWebFetchCalls: 5,
            maxWebSearchCalls: 3,
            maxWebResearchCalls: 2,
            maxBrowserCalls: 8,
            maxBrowserInteractionCalls: 6,
          },
          onToolEvent: trace.onToolEvent,
        }),
        messages: [],
        isStreaming: false,
        streamMessage: null,
        pendingToolCalls: new Set(),
      },
      getApiKey: (provider: string) => {
        if (!this.cfg.apiKey) {
          return undefined;
        }
        if (provider === this.cfg.provider || provider === "openai") {
          return this.cfg.apiKey;
        }
        return undefined;
      },
    }) as unknown as PiAgentLike;

    return {
      agent,
      abortController,
    };
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
