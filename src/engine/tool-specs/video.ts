import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EngineTooling } from "../types.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createVideoPiTools(params: {
  sessionKey: string;
  tooling: EngineTooling;
  textResult: (text: string) => TextBlock[];
  reserveToolCall: (tool: string) => { blocked: { content: TextBlock[]; details: unknown } } | null;
  logToolStart: (tool: string, rawParams: unknown) => string;
  logToolEnd: (
    tool: string,
    intent: string,
    result: unknown,
    startedAtMs: number,
    summary?: string,
  ) => void;
}): AgentTool[] {
  const videoHlsInspectTool: AgentTool = {
    name: "video_hls_inspect",
    label: "Video HLS Inspect",
    description:
      "Analisa manifesto HLS (.m3u8) e retorna estrutura (master/media), variants, renditions e primeiros segmentos em JSON.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL do manifesto HLS (http/https)" },
        maxSegments: { type: "number", description: "Quantidade maxima de segmentos retornados" },
        timeoutMs: { type: "number", description: "Timeout de fetch do manifesto" },
      },
      required: ["url"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveToolCall("video_hls_inspect");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { url: string; maxSegments?: number; timeoutMs?: number };
      const intent = params.logToolStart("video_hls_inspect", args);
      try {
        const result = await params.tooling.videoHlsInspect({
          sessionKey: params.sessionKey,
          url: args.url,
          maxSegments: args.maxSegments,
          timeoutMs: args.timeoutMs,
        });
        const text = [
          `ok=${result.ok}`,
          `playlistType=${result.playlistType}`,
          `variants=${result.variants.length}`,
          `renditions=${result.renditions.length}`,
          `segments=${result.segments.length}`,
          `finalUrl=${result.finalUrl}`,
          ...(result.errors.length > 0 ? ["errors:", ...result.errors.map((e) => `- ${e}`)] : []),
        ].join("\n");
        params.logToolEnd("video_hls_inspect", intent, result, startedAtMs);
        return { content: params.textResult(text), details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details = { ok: false, status: "failed", error: message };
        params.logToolEnd("video_hls_inspect", intent, details, startedAtMs);
        return { content: params.textResult(`ok=false\nerror=${message}`), details };
      }
    },
  };

  const videoProbeTool: AgentTool = {
    name: "video_probe",
    label: "Video Probe",
    description:
      "Executa ffprobe em arquivo/URL e retorna format/streams estruturados. Opcionalmente inclui timestamps de keyframes para analises como GOP.",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "Arquivo local ou URL para ffprobe" },
        timeoutMs: { type: "number", description: "Timeout do ffprobe" },
        keyframes: { type: "boolean", description: "Se true, extrai timestamps dos keyframes" },
        maxKeyframes: { type: "number", description: "Limite de keyframes retornados" },
        streamSelector: { type: "string", description: "Selecao ffprobe (ex: v:0)" },
      },
      required: ["input"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveToolCall("video_probe");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        input: string;
        timeoutMs?: number;
        keyframes?: boolean;
        maxKeyframes?: number;
        streamSelector?: string;
      };
      const intent = params.logToolStart("video_probe", args);
      try {
        const result = await params.tooling.videoProbe({
          sessionKey: params.sessionKey,
          input: args.input,
          timeoutMs: args.timeoutMs,
          keyframes: args.keyframes,
          maxKeyframes: args.maxKeyframes,
          streamSelector: args.streamSelector,
        });
        const streamsCount = Array.isArray(result.streams) ? result.streams.length : 0;
        const keyframeCount = result.keyframes?.count ?? 0;
        const text = [
          `ok=${result.ok}`,
          `input=${result.input}`,
          `streams=${streamsCount}`,
          `keyframes=${keyframeCount}`,
          ...(result.errors.length > 0 ? ["errors:", ...result.errors.map((e) => `- ${e}`)] : []),
        ].join("\n");
        params.logToolEnd("video_probe", intent, result, startedAtMs);
        return { content: params.textResult(text), details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details = { ok: false, status: "failed", error: message };
        params.logToolEnd("video_probe", intent, details, startedAtMs);
        return { content: params.textResult(`ok=false\nerror=${message}`), details };
      }
    },
  };

  return [videoHlsInspectTool, videoProbeTool];
}

