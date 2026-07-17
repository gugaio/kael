import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { PiEngineConfig } from "../config.js";
import { extractAssistantTextFromSdkMessage, getSdkErrorMessage } from "./pi-sdk-messages.js";
import { PiEngineError, normalizePiError } from "./pi-errors.js";

export type PiAgentLike = {
  prompt: (prompt: string) => Promise<void>;
  abort: () => void;
  subscribe: (listener: (event: unknown) => void) => (() => void) | void;
};

export type CreatedPiAgent = {
  agent: PiAgentLike;
  abortController: AbortController;
};

/** Shared PI infrastructure for the main agent and isolated agent profiles. */
export class PiAgentRuntime {
  constructor(private readonly config: PiEngineConfig) {}

  get available(): boolean {
    return this.config.enabled && Boolean(this.config.apiKey);
  }

  get model(): string {
    return this.config.model;
  }

  createAgent(params: {
    systemPrompt: string;
    tools?: AgentTool[];
    createTools?: (signal: AbortSignal) => AgentTool[];
    thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  }): CreatedPiAgent {
    const model = getModel(this.config.provider as never, this.config.model);
    if (!model) {
      throw new PiEngineError({
        message: `Model not found for provider=${this.config.provider} model=${this.config.model}`,
        code: "provider_unavailable",
        retryable: false,
      });
    }
    const abortController = new AbortController();
    const agent = new Agent({
      initialState: {
        systemPrompt: params.systemPrompt,
        model,
        thinkingLevel: params.thinkingLevel ?? "low",
        tools: params.createTools?.(abortController.signal) ?? params.tools ?? [],
        messages: [],
      },
      getApiKey: (provider: string) => {
        if (provider === this.config.provider || provider === "openai") return this.config.apiKey;
        return undefined;
      },
    }) as unknown as PiAgentLike;
    return { agent, abortController };
  }

  async runText(params: {
    systemPrompt: string;
    prompt: string;
    tools?: AgentTool[];
    thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
    timeoutMs?: number;
  }): Promise<string> {
    if (!this.available) {
      throw new PiEngineError({ message: "Pi runtime unavailable", code: "provider_unavailable", retryable: false });
    }
    const { agent, abortController } = this.createAgent(params);
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let unsubscribe: (() => void) | undefined;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe?.();
        callback();
      };
      const timeout = setTimeout(() => {
        finish(() => {
          abortController.abort(new DOMException("Pi isolated run timed out", "AbortError"));
          agent.abort();
          reject(new PiEngineError({ message: "Pi isolated run timed out", code: "timeout", retryable: true }));
        });
      }, params.timeoutMs ?? this.config.timeoutMs);
      const unsub = agent.subscribe((event) => {
        const typed = event as { type?: unknown; messages?: unknown } | null;
        if (!typed || typed.type !== "agent_end") return;
        finish(() => {
          const sdkError = getSdkErrorMessage(event);
          if (sdkError) {
            reject(normalizePiError(new Error(`Pi SDK agent error: ${sdkError}`)));
            return;
          }
          const messages = Array.isArray(typed.messages) ? typed.messages : [];
          const assistant = [...messages].reverse().find((message) => (message as { role?: unknown })?.role === "assistant");
          const text = extractAssistantTextFromSdkMessage(assistant);
          if (!text) {
            reject(new PiEngineError({ message: "Pi SDK returned empty content", code: "invalid_response", retryable: false }));
            return;
          }
          resolve(text);
        });
      });
      if (typeof unsub === "function") unsubscribe = unsub;
      agent.prompt(params.prompt).catch((error) => finish(() => reject(normalizePiError(error))));
    });
  }
}
