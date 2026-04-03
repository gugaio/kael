import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EngineOutputArtifact } from "../types.js";
import type { EngineToolingNamespaces } from "../types.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createImagePiTool(params: {
  sessionKey: string;
  tooling: EngineToolingNamespaces["image"];
  textResult: (text: string) => TextBlock[];
  makeBlockedResult: (params: {
    reason: string;
    retryAfterMs?: number;
    nextAction?: string;
  }) => { content: TextBlock[]; details: unknown };
  reserveImageCall: () => { blocked: { content: TextBlock[]; details: unknown } } | null;
  logToolStart: (tool: string, rawParams: unknown) => string;
  logToolEnd: (
    tool: string,
    intent: string,
    result: unknown,
    startedAtMs: number,
    summary?: string,
    artifact?: EngineOutputArtifact,
  ) => void;
}): AgentTool {
  return {
    name: "image_generate",
    label: "Image Generate",
    description:
      "Gera uma imagem a partir de prompt e retorna referencia para envio em canais que suportam anexo.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Descricao da imagem a gerar" },
        size: {
          type: "string",
          enum: ["1024x1024", "1536x1024", "1024x1536"],
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveImageCall();
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        prompt: string;
        size?: "1024x1024" | "1536x1024" | "1024x1536";
      };
      const intent = params.logToolStart("image_generate", args);
      if (!params.tooling.imageGenerate) {
        const reason = "image_generate_unavailable";
        const details = params.makeBlockedResult({ reason }).details;
        params.logToolEnd("image_generate", intent, details, startedAtMs);
        return {
          content: params.textResult(`blocked=true\nreason=${reason}`),
          details,
        };
      }
      try {
        const artifact = await params.tooling.imageGenerate({
          sessionKey: params.sessionKey,
          prompt: args.prompt,
          size: args.size,
        });
        const details = {
          status: "completed",
          kind: artifact.kind,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
        };
        params.logToolEnd(
          "image_generate",
          intent,
          details,
          startedAtMs,
          `image_generated file=${artifact.fileName} mime=${artifact.mimeType}`,
          artifact,
        );
        return {
          content: params.textResult(`ok=true\nimage_generated=${artifact.fileName}\nmime=${artifact.mimeType}`),
          details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details = {
          status: "failed",
          blocked: false,
          reason: "image_generate_failed",
          error: message,
        };
        params.logToolEnd("image_generate", intent, details, startedAtMs, `image_generate_failed error=${message}`);
        return {
          content: params.textResult(`ok=false\nreason=image_generate_failed\nerror=${message}`),
          details,
        };
      }
    },
  };
}
