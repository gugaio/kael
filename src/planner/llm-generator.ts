import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { retry } from "../infra/retry.js";
import type { PiEngineConfig } from "../config.js";
import type { PlanActionKind, PlanExecutionInputs, PlanStepDraftInput } from "./service.js";

type PiAgentLike = {
  prompt: (prompt: string) => Promise<void>;
  abort: () => void;
  subscribe: (listener: (event: unknown) => void) => (() => void) | void;
};

type PlannerModelOutput = {
  title?: string;
  steps?: Array<{
    title?: string;
    action?: {
      kind?: PlanActionKind;
      params?: PlanExecutionInputs;
    };
  }>;
};

const SUPPORTED_KINDS: PlanActionKind[] = ["probe", "capture", "transcode", "hls", "exec"];

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

function extractJsonObject(text: string): string {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last < 0 || last <= first) {
    throw new Error("planner model response did not contain a JSON object");
  }
  return cleaned.slice(first, last + 1);
}

function toDrafts(output: PlannerModelOutput, maxSteps?: number): PlanStepDraftInput[] {
  const rawSteps = Array.isArray(output.steps) ? output.steps : [];
  const limit = Number.isFinite(maxSteps) ? Math.max(1, Math.min(20, Math.floor(maxSteps ?? 8))) : 8;
  const drafts: PlanStepDraftInput[] = [];
  for (const step of rawSteps) {
    const title = typeof step?.title === "string" ? step.title.trim() : "";
    const kind = step?.action?.kind;
    if (!title || !kind || !SUPPORTED_KINDS.includes(kind)) {
      continue;
    }
    const params = step?.action?.params && typeof step.action.params === "object" ? step.action.params : {};
    drafts.push({
      title,
      action: {
        kind,
        params,
      },
    });
    if (drafts.length >= limit) {
      break;
    }
  }
  return drafts;
}

function buildPlannerPrompt(params: { objective: string; maxSteps?: number }): string {
  const maxSteps = Number.isFinite(params.maxSteps) ? Math.max(1, Math.min(20, Math.floor(params.maxSteps ?? 8))) : 8;
  return [
    "Gere um plano operacional estruturado em JSON para um agente local.",
    "Responda APENAS JSON valido, sem markdown.",
    "",
    "Schema de saida:",
    '{"title":"string","steps":[{"title":"string","action":{"kind":"probe|capture|transcode|hls|exec","params":{}}}] }',
    "",
    "Regras:",
    "- Sempre preencha steps com acoes executaveis.",
    "- Para shell, use action.kind=exec e action.params.command completo.",
    "- Preserve paths absolutos quando informados (ex: /tmp/arquivo.txt).",
    "- Nao invente placeholders de video se o objetivo for shell.",
    `- Maximo de steps: ${String(maxSteps)}.`,
    "",
    "Objetivo:",
    params.objective,
  ].join("\n");
}

export class LlmPlanGenerator {
  constructor(private readonly cfg: PiEngineConfig) {}

  async generate(params: {
    objective: string;
    maxSteps?: number;
  }): Promise<PlanStepDraftInput[]> {
    if (!this.cfg.enabled || !this.cfg.apiKey) {
      return [];
    }

    return retry(
      async () => {
        const agent = this.createAgent();
        const text = await new Promise<string>((resolve, reject) => {
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
              reject(new Error("planner model call timed out"));
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
                reject(new Error(`planner model error: ${errorMessage}`));
                return;
              }

              const messages = Array.isArray(typedEvent.messages) ? typedEvent.messages : [];
              const assistant = [...messages]
                .reverse()
                .find((message) => (message as { role?: unknown })?.role === "assistant");
              const content = extractAssistantTextFromSdkMessage(assistant);
              if (!content) {
                reject(new Error("planner model returned empty content"));
                return;
              }
              resolve(content);
            });
          });

          if (typeof unsub === "function") {
            unsubscribe = unsub;
          }

          agent.prompt(buildPlannerPrompt(params)).catch((error) => {
            finish(() => reject(error instanceof Error ? error : new Error(String(error))));
          });
        });

        const parsed = JSON.parse(extractJsonObject(text)) as PlannerModelOutput;
        return toDrafts(parsed, params.maxSteps);
      },
      this.cfg.retry,
      () => true,
    );
  }

  private createAgent(): PiAgentLike {
    const model = getModel(this.cfg.provider as never, this.cfg.model);
    const agent = new Agent({
      initialState: {
        systemPrompt: [
          this.cfg.systemPrompt,
          "Modo planner estruturado: responda apenas JSON valido sem comentarios.",
        ].join("\n\n"),
        model,
        thinkingLevel: "low",
        tools: [],
        messages: [],
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
