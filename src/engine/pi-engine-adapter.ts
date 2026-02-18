import type { PiEngineConfig } from "../config.js";
import type { AgentEngine, EngineTurnInput, EngineTurnOutput } from "./types.js";

function getAssistantText(payload: unknown): string | null {
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

export class PiEngineAdapter implements AgentEngine {
  constructor(private readonly cfg: PiEngineConfig) {}

  async runTurn(input: EngineTurnInput): Promise<EngineTurnOutput> {
    if (!this.cfg.enabled || !this.cfg.apiKey) {
      throw new Error("Pi engine disabled: missing KAEL_PI_API_KEY");
    }

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
              content:
                "Voce e Kael, assistente local de video e automacao. Seja direto e tecnico. Se o usuario enviar comando slash, peça para usar o executor local.",
            },
            {
              role: "user",
              content: input.message,
            },
          ],
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as unknown;

      if (!response.ok) {
        const detail =
          typeof payload === "object" && payload && "error" in payload
            ? JSON.stringify((payload as { error: unknown }).error)
            : `status=${response.status}`;
        throw new Error(`Pi engine HTTP error: ${detail}`);
      }

      const text = getAssistantText(payload);
      if (!text) {
        throw new Error("Pi engine returned empty content");
      }

      return { reply: text };
    } finally {
      clearTimeout(timeout);
    }
  }
}
