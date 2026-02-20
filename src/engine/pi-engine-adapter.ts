import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { PiEngineConfig } from "../config.js";
import { retry } from "../infra/retry.js";
import { normalizePiError, PiEngineError } from "./pi-errors.js";
import { createPiShellTools } from "./pi-tools.js";
import type { AgentEngine, EngineTurnInput, EngineTurnOutput } from "./types.js";

type PiAgentLike = {
  prompt: (prompt: string) => Promise<void>;
  abort: () => void;
  subscribe: (listener: (event: unknown) => void) => (() => void) | void;
};

function buildPrompt(input: EngineTurnInput): string {
  const context = input.contextMessages ?? [];
  if (context.length === 0) {
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
    "Mensagem atual do usuario:",
    input.message,
  ].join("\n");
}

function extractAssistantTextFromSdkMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const directContent = (message as { content?: unknown }).content;
  if (typeof directContent === "string" && directContent.trim()) {
    return directContent.trim();
  }

  if (Array.isArray(directContent)) {
    const joined = directContent
      .map((block) => {
        if (!block || typeof block !== "object") {
          return "";
        }
        const maybeText = (block as { text?: unknown }).text;
        return typeof maybeText === "string" ? maybeText : "";
      })
      .join("")
      .trim();
    if (joined) {
      return joined;
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
