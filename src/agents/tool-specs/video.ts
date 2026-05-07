import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EngineToolingInterface } from "../types.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createVideoPiTools(params: {
  sessionKey: string;
  tooling: EngineToolingInterface["video"];
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

  const videoManifestAuditTool: AgentTool = {
    name: "video_manifest_audit",
    label: "Video Manifest Audit",
    description:
      "Audita um manifesto HLS e retorna diagnostico objetivo com issues, severidade e recomendacoes para QA de streaming, operacao e release.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL do manifesto HLS (.m3u8)" },
        maxSegments: { type: "number", description: "Quantidade maxima de segmentos usados na auditoria" },
        timeoutMs: { type: "number", description: "Timeout de fetch do manifesto" },
        followVariants: {
          type: "boolean",
          description: "Se true, desce em memoria nas media playlists das variants selecionadas para auditoria expandida da ladder",
        },
        maxVariants: { type: "number", description: "Limite de variants auditadas quando followVariants=true" },
      },
      required: ["url"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveToolCall("video_manifest_audit");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        url: string;
        maxSegments?: number;
        timeoutMs?: number;
        followVariants?: boolean;
        maxVariants?: number;
      };
      const intent = params.logToolStart("video_manifest_audit", args);
      if (!params.tooling.videoManifestAudit) {
        const reason = "video_manifest_audit_unavailable";
        const details = { status: "blocked", blocked: true, reason };
        params.logToolEnd("video_manifest_audit", intent, details, startedAtMs);
        return {
          content: params.textResult(`blocked=true\nreason=${reason}`),
          details,
        };
      }
      try {
        const result = await params.tooling.videoManifestAudit({
          sessionKey: params.sessionKey,
          url: args.url,
          maxSegments: args.maxSegments,
          timeoutMs: args.timeoutMs,
          followVariants: args.followVariants,
          maxVariants: args.maxVariants,
        });
        const text = [
          `ok=${result.ok}`,
          `playlistType=${result.playlistType}`,
          `summary=${result.summary}`,
          `variants=${result.stats.variants}`,
          `renditions=${result.stats.renditions}`,
          `segments=${result.stats.segments}`,
          `variantsAudited=${result.stats.variantsAudited}`,
          `variantsWithErrors=${result.stats.variantsWithErrors}`,
          ...(typeof result.stats.targetDuration === "number"
            ? [`targetDuration=${result.stats.targetDuration}`]
            : []),
          ...(result.issues.length > 0 ? ["issues:", ...result.issues.map((issue) => `- ${issue.code}: ${issue.summary}`)] : []),
          ...(result.aggregateIssues.length > 0
            ? ["aggregateIssues:", ...result.aggregateIssues.map((issue) => `- ${issue.code}: ${issue.summary}`)]
            : []),
        ].join("\n");
        params.logToolEnd(
          "video_manifest_audit",
          intent,
          result,
          startedAtMs,
          `manifest ok=${result.ok} type=${result.playlistType} issues=${result.issues.length}`,
        );
        return { content: params.textResult(text), details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details = { status: "failed", blocked: false, reason: "video_manifest_audit_failed", error: message };
        params.logToolEnd("video_manifest_audit", intent, details, startedAtMs);
        return {
          content: params.textResult(`ok=false\nreason=video_manifest_audit_failed\nerror=${message}`),
          details,
        };
      }
    },
  };

  const videoManifestDiffTool: AgentTool = {
    name: "video_manifest_diff",
    label: "Video Manifest Diff",
    description:
      "Compara dois manifestos HLS usando o audit deterministico do Kael e destaca deltas de stats e issues adicionadas/removidas entre as duas versoes.",
    parameters: {
      type: "object",
      properties: {
        leftUrl: { type: "string", description: "URL base/referencia do manifesto HLS (.m3u8)" },
        rightUrl: { type: "string", description: "URL candidata/comparada do manifesto HLS (.m3u8)" },
        maxSegments: { type: "number", description: "Quantidade maxima de segmentos usados no audit" },
        timeoutMs: { type: "number", description: "Timeout de fetch dos manifests" },
        followVariants: { type: "boolean", description: "Se true, audita variants das duas ladders antes de comparar" },
        maxVariants: { type: "number", description: "Limite de variants auditadas por lado quando followVariants=true" },
      },
      required: ["leftUrl", "rightUrl"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveToolCall("video_manifest_diff");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        leftUrl: string;
        rightUrl: string;
        maxSegments?: number;
        timeoutMs?: number;
        followVariants?: boolean;
        maxVariants?: number;
      };
      const intent = params.logToolStart("video_manifest_diff", args);
      if (!params.tooling.videoManifestDiff) {
        const reason = "video_manifest_diff_unavailable";
        const details = { status: "blocked", blocked: true, reason };
        params.logToolEnd("video_manifest_diff", intent, details, startedAtMs);
        return {
          content: params.textResult(`blocked=true\nreason=${reason}`),
          details,
        };
      }
      try {
        const result = await params.tooling.videoManifestDiff({
          sessionKey: params.sessionKey,
          leftUrl: args.leftUrl,
          rightUrl: args.rightUrl,
          maxSegments: args.maxSegments,
          timeoutMs: args.timeoutMs,
          followVariants: args.followVariants,
          maxVariants: args.maxVariants,
        });
        const text = [
          `ok=${result.ok}`,
          `summary=${result.summary}`,
          `playlistTypeChanged=${result.playlistTypeChanged}`,
          `delta.variants=${result.delta.variants}`,
          `delta.renditions=${result.delta.renditions}`,
          `delta.segments=${result.delta.segments}`,
          `delta.variantsWithErrors=${result.delta.variantsWithErrors}`,
          `issues.added=${result.issueDiff.added.length}`,
          `issues.removed=${result.issueDiff.removed.length}`,
          `aggregateIssues.added=${result.aggregateIssueDiff.added.length}`,
          `aggregateIssues.removed=${result.aggregateIssueDiff.removed.length}`,
          `variants.added=${result.variantDiff.added.length}`,
          `variants.removed=${result.variantDiff.removed.length}`,
          `variants.regressed=${result.variantDiff.regressed.length}`,
          `variants.improved=${result.variantDiff.improved.length}`,
          `variants.changed=${result.variantDiff.changed.length}`,
          ...(result.issueDiff.added.length > 0
            ? ["addedIssues:", ...result.issueDiff.added.map((issue) => `- ${issue.code}: ${issue.summary}`)]
            : []),
          ...(result.variantDiff.regressed.length > 0
            ? [
                "regressedVariants:",
                ...result.variantDiff.regressed.map((item) =>
                  `- severity=${item.regressionSeverity} score=${item.regressionScore} ${item.summary}`
                ),
              ]
            : []),
        ].join("\n");
        params.logToolEnd(
          "video_manifest_diff",
          intent,
          result,
          startedAtMs,
          `manifest_diff ok=${result.ok} added=${result.issueDiff.added.length} removed=${result.issueDiff.removed.length}`,
        );
        return { content: params.textResult(text), details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details = { status: "failed", blocked: false, reason: "video_manifest_diff_failed", error: message };
        params.logToolEnd("video_manifest_diff", intent, details, startedAtMs);
        return {
          content: params.textResult(`ok=false\nreason=video_manifest_diff_failed\nerror=${message}`),
          details,
        };
      }
    },
  };

  const playbackAnalyzeTool: AgentTool = {
    name: "playback_analyze",
    label: "Playback Analyze",
    description:
      "Analisa logs textuais ou eventos estruturados de playback e retorna diagnostico inicial de sessao para players como hls.js, Shaka, ExoPlayer e AVPlayer.",
    parameters: {
      type: "object",
      properties: {
        player: {
          type: "string",
          enum: ["generic", "avplayer", "exoplayer", "hlsjs", "shaka"],
          description: "Engine/player de origem dos logs",
        },
        logText: {
          type: "string",
          description: "Texto bruto de logs do player. Preferir este campo para hls.js e logs copiados de observabilidade.",
        },
        events: {
          type: "array",
          description: "Eventos estruturados opcionais, quando ja houver normalizacao externa.",
          items: {
            type: "object",
            properties: {
              atMs: { type: "number" },
              name: { type: "string" },
              category: {
                type: "string",
                enum: ["lifecycle", "buffer", "network", "abr", "drm", "quality", "error", "user"],
              },
              detail: { type: "string" },
              fatal: { type: "boolean" },
            },
            required: ["atMs", "name", "category"],
            additionalProperties: true,
          },
        },
        source: { type: "string", description: "Origem do log, ex.: xray, splunk, browser console" },
        streamUrl: { type: "string", description: "URL do stream relacionado, se houver" },
      },
      required: ["player"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveToolCall("playback_analyze");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        player: "generic" | "avplayer" | "exoplayer" | "hlsjs" | "shaka";
        logText?: string;
        events?: Array<{
          atMs: number;
          name: string;
          category: "lifecycle" | "buffer" | "network" | "abr" | "drm" | "quality" | "error" | "user";
          detail?: string;
          fatal?: boolean;
        }>;
        source?: string;
        streamUrl?: string;
      };
      const intent = params.logToolStart("playback_analyze", args);
      if (!params.tooling.playbackAnalyze) {
        const reason = "playback_analyze_unavailable";
        const details = { status: "blocked", blocked: true, reason };
        params.logToolEnd("playback_analyze", intent, details, startedAtMs);
        return {
          content: params.textResult(`blocked=true\nreason=${reason}`),
          details,
        };
      }
      try {
        const result = await params.tooling.playbackAnalyze({
          sessionKey: params.sessionKey,
          player: args.player,
          logText: args.logText,
          events: args.events,
          source: args.source,
          streamUrl: args.streamUrl,
        });
        const text = [
          `ok=${result.ok}`,
          `player=${result.player}`,
          `summary=${result.summary}`,
          `events=${result.metrics.eventCount}`,
          `errors=${result.metrics.errorCount}`,
          `fatalErrors=${result.metrics.fatalErrorCount}`,
          `rebuffer=${result.metrics.rebufferCount}`,
          ...(typeof result.metrics.startupTimeMs === "number"
            ? [`startupTimeMs=${result.metrics.startupTimeMs}`]
            : []),
          ...(result.issues.length > 0 ? ["issues:", ...result.issues.map((issue) => `- ${issue.code}: ${issue.summary}`)] : []),
        ].join("\n");
        params.logToolEnd(
          "playback_analyze",
          intent,
          result,
          startedAtMs,
          `playback ok=${result.ok} player=${result.player} issues=${result.issues.length}`,
        );
        return { content: params.textResult(text), details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details = { status: "failed", blocked: false, reason: "playback_analyze_failed", error: message };
        params.logToolEnd("playback_analyze", intent, details, startedAtMs);
        return {
          content: params.textResult(`ok=false\nreason=playback_analyze_failed\nerror=${message}`),
          details,
        };
      }
    },
  };

  const videoStreamWatchTool: AgentTool = {
    name: "video_stream_watch",
    label: "Video Stream Watch",
    description:
      "Inicia, para ou consulta uma sessao de monitoramento continuo de stream HLS. " +
      "Quando action=start, o Kael passa a fazer polling periodico do manifesto e detecta automaticamente: " +
      "descontinuidades (#EXT-X-DISCONTINUITY), gaps de mediaSequence, manifest congelado (stale), " +
      "anomalias de duracao de segmento e desaparecimento de rendisoes de audio. " +
      "Use action=status para consultar eventos detectados e action=stop para encerrar a sessao.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "stop", "status", "list"],
          description: "Acao a executar: start=inicia monitoramento, stop=encerra, status=consulta eventos, list=lista sessoes",
        },
        url: {
          type: "string",
          description: "URL do manifesto HLS (.m3u8) a monitorar. Obrigatorio quando action=start.",
        },
        pollIntervalMs: {
          type: "number",
          description: "Intervalo entre polls em ms. Padrao: 5000. Minimo: 1000.",
        },
        maxPollCount: {
          type: "number",
          description: "Numero maximo de polls antes de encerrar automaticamente. Omitir para monitoramento continuo.",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout de fetch por poll em ms. Padrao: 15000.",
        },
        watchId: {
          type: "string",
          description: "ID da sessao de monitoramento. Obrigatorio para action=stop e action=status.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveToolCall("video_stream_watch");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        action: "start" | "stop" | "status" | "list";
        url?: string;
        pollIntervalMs?: number;
        maxPollCount?: number;
        timeoutMs?: number;
        watchId?: string;
      };
      const intent = params.logToolStart("video_stream_watch", args);
      if (!params.tooling.videoStreamWatch) {
        const reason = "video_stream_watch_unavailable";
        const details = { status: "blocked", blocked: true, reason };
        params.logToolEnd("video_stream_watch", intent, details, startedAtMs);
        return {
          content: params.textResult(`blocked=true\nreason=${reason}`),
          details,
        };
      }
      try {
        const result = await params.tooling.videoStreamWatch({
          action: args.action,
          sessionKey: params.sessionKey,
          url: args.url,
          pollIntervalMs: args.pollIntervalMs,
          maxPollCount: args.maxPollCount,
          timeoutMs: args.timeoutMs,
          watchId: args.watchId,
        });
        const textLines = [
          `ok=${result.ok}`,
          `action=${result.action}`,
        ];
        if (result.watchId) textLines.push(`watchId=${result.watchId}`);
        if (result.stopped !== undefined) textLines.push(`stopped=${result.stopped}`);
        if (result.status) {
          const s = result.status;
          textLines.push(
            `running=${s.running}`,
            `pollCount=${s.pollCount}`,
            `errorCount=${s.errorCount}`,
            `events=${s.events.length}`,
            `lastPollAt=${s.lastPollAt ?? "never"}`,
          );
          if (s.events.length > 0) {
            textLines.push("detectedEvents:");
            for (const ev of s.events.slice(-10)) {
              textLines.push(`- [${ev.severity}] ${ev.code}: ${ev.summary}`);
            }
          }
        }
        if (result.watches) {
          textLines.push(`sessions=${result.watches.length}`);
          for (const w of result.watches) {
            textLines.push(`- id=${w.id} running=${w.running} polls=${w.pollCount} events=${w.events.length} url=${w.url}`);
          }
        }
        params.logToolEnd("video_stream_watch", intent, result, startedAtMs);
        return { content: params.textResult(textLines.join("\n")), details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details = { status: "failed", blocked: false, reason: "video_stream_watch_failed", error: message };
        params.logToolEnd("video_stream_watch", intent, details, startedAtMs);
        return {
          content: params.textResult(`ok=false\nreason=video_stream_watch_failed\nerror=${message}`),
          details,
        };
      }
    },
  };

  return [
    videoHlsInspectTool,
    videoProbeTool,
    videoManifestAuditTool,
    videoManifestDiffTool,
    playbackAnalyzeTool,
    videoStreamWatchTool,
  ];
}
