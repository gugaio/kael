import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { PiEngineConfig } from "../config.js";
import { retry } from "../infra/retry.js";
import { normalizePiError, PiEngineError } from "./pi-errors.js";
import { createPiShellTools } from "./pi-tools.js";
import { ToolLoopGuard } from "./tool-loop-guard.js";
import type { AgentEngine, EngineTurnInput, EngineTurnOutput } from "./types.js";

type PiAgentLike = {
  prompt: (prompt: string) => Promise<void>;
  abort: () => void;
  subscribe: (listener: (event: unknown) => void) => (() => void) | void;
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

function buildPrompt(input: EngineTurnInput): string {
  const context = input.contextMessages ?? [];
  if (context.length === 0) {
    if (isSelfKnowledgeQuestion(input.message)) {
      return [
        "Pergunta sobre o proprio Kael detectada.",
        "Antes de responder, investigue o workspace com workspace_search e workspace_read e responda com evidencias (arquivo:linha).",
        "",
        "Mensagem atual do usuario:",
        input.message,
      ].join("\n");
    }
    return input.message;
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
    "Instrucao critica: responda a MENSAGEM ATUAL do usuario. Nao continue tarefas antigas sem pedido explicito.",
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

export class PiEngineAdapter implements AgentEngine {
  private readonly loopGuard = new ToolLoopGuard();

  constructor(private readonly cfg: PiEngineConfig) {}

  async runTurn(input: EngineTurnInput): Promise<EngineTurnOutput> {
    if (!this.cfg.enabled) {
      throw new PiEngineError({
        message: "Pi engine disabled",
        code: "provider_unavailable",
        retryable: false,
      });
    }

    return retry(
      async () => {
        const agent = this.createSdkAgent(input);

        return new Promise<EngineTurnOutput>((resolve, reject) => {
          let settled = false;
          let unsubscribe: (() => void) | undefined;

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
              agent.abort();
              reject(
                new PiEngineError({
                  message: "Pi SDK call timed out",
                  code: "timeout",
                  retryable: true,
                }),
              );
            });
          }, this.cfg.timeoutMs);

          const unsub = agent.subscribe((event) => {
            const typedEvent = event as { type?: unknown; messages?: unknown } | null;
            if (!typedEvent || typedEvent.type !== "agent_end") {
              return;
            }

            finish(() => {
              const errorMessage = asSdkErrorMessage(event);
              if (errorMessage) {
                reject(normalizePiError(new Error(`Pi SDK agent error: ${errorMessage}`)));
                return;
              }

              const messages = Array.isArray(typedEvent.messages) ? typedEvent.messages : [];
              const assistant = [...messages]
                .reverse()
                .find((message) => (message as { role?: unknown })?.role === "assistant");

              const text = extractAssistantTextFromSdkMessage(assistant);
              if (!text) {
                reject(
                  new PiEngineError({
                    message: "Pi SDK returned empty content",
                    code: "invalid_response",
                    retryable: false,
                  }),
                );
                return;
              }

              resolve({ reply: text });
            });
          });
          if (typeof unsub === "function") {
            unsubscribe = unsub;
          }

          agent.prompt(buildPrompt(input)).catch((error) => {
            finish(() => reject(normalizePiError(error)));
          });
        });
      },
      this.cfg.retry,
      ({ error }) => normalizePiError(error).retryable,
    );
  }

  private createSdkAgent(input: EngineTurnInput): PiAgentLike {
    const model = getModel(this.cfg.provider as never, this.cfg.model);
    const agent = new Agent({
      initialState: {
        systemPrompt: this.cfg.systemPrompt,
        model,
        thinkingLevel: "minimal",
        tools: createPiShellTools({
          sessionKey: input.sessionKey,
          tooling: input.tooling,
          loopGuard: this.loopGuard,
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

    return agent;
  }
}
