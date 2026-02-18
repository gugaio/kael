import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { PiEngineConfig } from "../config.js";
import { retry } from "../infra/retry.js";
import { LocalProcessRunner, type ProcessRunner } from "../tools/system/process-runner.js";
import { classifyHttpError, normalizePiError, PiEngineError } from "./pi-errors.js";
import type { AgentEngine, EngineTurnInput, EngineTurnOutput } from "./types.js";

type PiAgentLike = {
  prompt: (prompt: string) => Promise<void>;
  abort: () => void;
  subscribe: (listener: (event: unknown) => void) => (() => void) | void;
};

function toProviderMessages(input: EngineTurnInput): Array<{ role: "user" | "assistant"; content: string }> {
  const context = input.contextMessages ?? [];
  const normalizedContext = context
    .filter((item) => item.content.trim().length > 0)
    .map((item) => ({
      role: item.role,
      content: item.content,
    }));

  return [
    ...normalizedContext,
    {
      role: "user",
      content: input.message,
    },
  ];
}

function buildPromptForSingleInputProvider(input: EngineTurnInput): string {
  const context = input.contextMessages ?? [];
  if (context.length === 0) {
    return input.message;
  }

  const serializedContext = context
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

function getAssistantTextFromHttpPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const maybeChoices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(maybeChoices) || maybeChoices.length === 0) {
    return null;
  }

  const first = maybeChoices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  return null;
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
  private sdkAgent: PiAgentLike | null = null;

  constructor(
    private readonly cfg: PiEngineConfig,
    private readonly runner: ProcessRunner = new LocalProcessRunner(),
  ) {}

  async runTurn(input: EngineTurnInput): Promise<EngineTurnOutput> {
    if (!this.cfg.enabled) {
      throw new PiEngineError({
        message: "Pi engine disabled",
        code: "provider_unavailable",
        retryable: false,
      });
    }

    if (this.cfg.transport === "pi_sdk") {
      return this.runSdkTurn(input);
    }

    if (this.cfg.transport === "local_process") {
      return this.runLocalProcessTurn(input);
    }

    if (!this.cfg.apiKey) {
      throw new PiEngineError({
        message: "Pi engine HTTP mode requires KAEL_PI_API_KEY",
        code: "auth",
        retryable: false,
      });
    }

    return this.runHttpTurn(input);
  }

  private runHttpTurn(input: EngineTurnInput): Promise<EngineTurnOutput> {
    return retry(
      async () => {
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), this.cfg.timeoutMs);

        try {
          const response = await fetch(this.cfg.apiUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${this.cfg.apiKey}`,
            },
            signal: abortController.signal,
            body: JSON.stringify({
              model: this.cfg.model,
              temperature: 0.2,
              messages: [
                {
                  role: "system",
                  content: this.cfg.systemPrompt,
                },
                ...toProviderMessages(input),
              ],
            }),
          });

          const payload = (await response.json().catch(() => ({}))) as unknown;

          if (!response.ok) {
            const detail =
              typeof payload === "object" && payload && "error" in payload
                ? JSON.stringify((payload as { error: unknown }).error)
                : `status=${response.status}`;
            throw classifyHttpError(response.status, detail);
          }

          const text = getAssistantTextFromHttpPayload(payload);
          if (!text) {
            throw new PiEngineError({
              message: "Pi engine returned empty content",
              code: "invalid_response",
              retryable: false,
            });
          }

          return { reply: text };
        } catch (error) {
          throw normalizePiError(error);
        } finally {
          clearTimeout(timeout);
        }
      },
      this.cfg.retry,
      ({ error }) => normalizePiError(error).retryable,
    );
  }

  private runLocalProcessTurn(input: EngineTurnInput): Promise<EngineTurnOutput> {
    return retry(
      async () => {
        const { process } = this.runner.spawn(this.cfg.local.command, this.cfg.local.args, {
          env: {
            KAEL_PI_PROVIDER: this.cfg.provider,
            KAEL_PI_MODEL: this.cfg.model,
          },
        });

        return new Promise<EngineTurnOutput>((resolve, reject) => {
          let stdout = "";
          let stderr = "";
          let settled = false;

          const timeout = setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            process.kill("SIGTERM");
            reject(
              new PiEngineError({
                message: "Pi local process timed out",
                code: "timeout",
                retryable: true,
              }),
            );
          }, this.cfg.timeoutMs);

          const finish = (result: () => void): void => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timeout);
            result();
          };

          process.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf-8");
          });

          process.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf-8");
          });

          process.on("error", (error) => {
            finish(() => {
              reject(
                new PiEngineError({
                  message: `Pi local process failed to spawn: ${error.message}`,
                  code: "provider_unavailable",
                  retryable: true,
                }),
              );
            });
          });

          process.on("close", (code) => {
            finish(() => {
              if (code !== 0) {
                reject(
                  new PiEngineError({
                    message: `Pi local process failed (exit=${String(code)}): ${stderr.trim() || "sem stderr"}`,
                    code: "provider_unavailable",
                    retryable: true,
                  }),
                );
                return;
              }

              const reply = stdout.trim();
              if (!reply) {
                reject(
                  new PiEngineError({
                    message: "Pi local process returned empty content",
                    code: "invalid_response",
                    retryable: false,
                  }),
                );
                return;
              }

              resolve({ reply });
            });
          });

          const prompt = buildPromptForSingleInputProvider(input);
          process.stdin.write(`${prompt}\n`);
          process.stdin.end();
        });
      },
      this.cfg.retry,
      ({ error }) => normalizePiError(error).retryable,
    );
  }

  private runSdkTurn(input: EngineTurnInput): Promise<EngineTurnOutput> {
    return retry(
      async () => {
        const agent = this.getOrCreateSdkAgent();

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
                reject(
                  normalizePiError(
                    new Error(`Pi SDK agent error: ${errorMessage}`),
                  ),
                );
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

          const prompt = buildPromptForSingleInputProvider(input);
          agent.prompt(prompt).catch((error) => {
            finish(() => reject(normalizePiError(error)));
          });
        });
      },
      this.cfg.retry,
      ({ error }) => normalizePiError(error).retryable,
    );
  }

  private getOrCreateSdkAgent(): PiAgentLike {
    if (this.sdkAgent) {
      return this.sdkAgent;
    }

    const model = getModel(this.cfg.provider as never, this.cfg.model);
    const agent = new Agent({
      initialState: {
        systemPrompt: this.cfg.systemPrompt,
        model,
        thinkingLevel: "minimal",
        tools: [],
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

    this.sdkAgent = agent;
    return agent;
  }
}
