import type { PiEngineConfig } from "../config.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { retry } from "../infra/retry.js";
import { PiAgentRuntime } from "../agents/pi-runtime.js";
import type {
  MediaInvestigationAgentInput,
  MediaInvestigationAgentRunner,
  MediaAgentPromptSnapshot,
} from "./types.js";

/** Executes investigation profiles through Kael's shared PI runtime. */
export class MediaInvestigationProfileRunner implements MediaInvestigationAgentRunner {
  readonly available: boolean;
  readonly model: string;

  constructor(
    private readonly config: PiEngineConfig,
    private readonly runtime: PiAgentRuntime,
  ) {
    this.available = runtime.available;
    this.model = runtime.model;
  }

  async run(params: {
    prompt: MediaAgentPromptSnapshot;
    input: MediaInvestigationAgentInput;
    tools?: AgentTool[];
  }): Promise<{ raw: string; parsed: unknown }> {
    if (!this.available) {
      throw new Error("PI media investigation agents require KAEL_PI_API_KEY");
    }
    return retry(
      async () => {
        const raw = await this.runOnce(params);
        return { raw, parsed: JSON.parse(extractJsonObject(raw)) as unknown };
      },
      this.config.retry,
      () => true,
    );
  }

  private async runOnce(params: {
    prompt: MediaAgentPromptSnapshot;
    input: MediaInvestigationAgentInput;
    tools?: AgentTool[];
  }): Promise<string> {
    const input = JSON.stringify(params.input);
    return this.runtime.runText({
      systemPrompt: params.prompt.content,
      thinkingLevel: "medium",
      tools: params.tools,
      prompt: [
        "Analise o problema relatado e o pacote JSON de evidencias abaixo.",
        ...(params.tools?.length ? ["Use as tools disponiveis quando uma nova medicao puder confirmar ou rejeitar hipoteses."] : []),
        "Responda apenas JSON valido conforme seu system prompt.",
        "Nao invente fatos e use somente evidenceIds existentes.",
        "",
        input,
      ].join("\n"),
    });
  }
}

function extractJsonObject(text: string): string {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("media investigation agent response did not contain a JSON object");
  }
  return cleaned.slice(first, last + 1);
}
