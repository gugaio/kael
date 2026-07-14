import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MediaInspector, PlaybackTriageService } from "@gugaio/vhs";
import type { StreamerRuntime } from "../../runtime/agent-runtime.js";
import type { StreamServeManager } from "../../video/serve-manager.js";
import type { HlsStreamMonitorService } from "../../vhs/watch-registry.js";
import { runStreamChunkCommand } from "../../ffmpeg/chunk-command.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createVideoPiTools(params: {
  sessionKey: string;
  videoInspect: Pick<MediaInspector, "inspectHls" | "probe">;
  playbackTriage: PlaybackTriageService;
  streamMonitor: HlsStreamMonitorService;
  streamer: StreamerRuntime;
  serveManager: StreamServeManager;
  textResult: (text: string) => TextBlock[];
  reserveToolCall: (tool: string) => { blocked: { content: TextBlock[]; details: unknown } } | null;
  reserveStreamerCall?: () => { blocked: { content: TextBlock[]; details: unknown } } | null;
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
        const result = await params.videoInspect.inspectHls({
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
        const result = await params.videoInspect.probe({
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
      try {
        const result = await params.playbackTriage.analyzeSession({
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
      "Inicia, para, remove ou consulta uma sessao de monitoramento continuo de stream HLS. " +
      "Use profile=manifest para polling leve; profile=chunks/full para baixar uma janela, analisar chunks e gerar report. " +
      "Quando profile=manifest, o Kael passa a fazer polling periodico do manifesto e detecta automaticamente: " +
      "descontinuidades (#EXT-X-DISCONTINUITY), gaps de mediaSequence, manifest congelado (stale), " +
      "anomalias de duracao de segmento e desaparecimento de rendisoes de audio. " +
      "Use action=status para consultar eventos detectados e action=stop para encerrar a sessao.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "stop", "status", "list", "delete"],
          description: "Acao a executar: start=inicia monitoramento, stop=encerra, status=consulta eventos, list=lista sessoes, delete=remove artefatos",
        },
        profile: {
          type: "string",
          enum: ["manifest", "chunks", "full"],
          description: "Intensidade do watch. manifest=leve, chunks=baixa/análise janela, full=análise mais ampla. Padrao: manifest.",
        },
        mode: {
          type: "string",
          enum: ["auto", "vod", "live"],
          description: "Tipo esperado da URL. live usa maxDurationMs como janela alvo. Padrao: auto.",
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
        maxDurationMs: {
          type: "number",
          description: "Duracao maxima da janela para profile=chunks/full, especialmente live. Padrao: 3600000.",
        },
        retentionHours: {
          type: "number",
          description: "Horas ate cleanup dos artefatos do watch. Padrao: 24.",
        },
        variantSelector: {
          type: "string",
          description: "Variant para master playlist: aac-highest, aac-lowest, highest, lowest ou indice zero-based.",
        },
        allVariants: {
          type: "boolean",
          description: "Baixar/analisar todas as variants. Cuidado: pode consumir muita rede/disco.",
        },
        watchId: {
          type: "string",
          description: "ID da sessao de monitoramento. Obrigatorio para action=stop, status e delete.",
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
        action: "start" | "stop" | "status" | "list" | "delete";
        url?: string;
        profile?: "manifest" | "chunks" | "full";
        mode?: "auto" | "vod" | "live";
        pollIntervalMs?: number;
        maxPollCount?: number;
        timeoutMs?: number;
        maxDurationMs?: number;
        retentionHours?: number;
        variantSelector?: string;
        allVariants?: boolean;
        watchId?: string;
      };
      const intent = params.logToolStart("video_stream_watch", args);
      try {
        type WatchToolResult = {
          ok: boolean;
          action: typeof args.action;
          watchId?: string;
          stopped?: boolean;
          removed?: boolean;
          status?: ReturnType<typeof params.streamMonitor.getStatus> extends infer T ? NonNullable<T> : never;
          watches?: ReturnType<typeof params.streamMonitor.listWatches>;
        };
        const result: WatchToolResult | Promise<WatchToolResult> = (() => {
          if (args.action === "start") {
            if (!args.url) return { ok: false, action: args.action, watchId: undefined };
            const id = params.streamMonitor.startWatch({
              sessionKey: params.sessionKey,
              url: args.url,
              profile: args.profile,
              mode: args.mode,
              pollIntervalMs: args.pollIntervalMs,
              maxPollCount: args.maxPollCount,
              timeoutMs: args.timeoutMs,
              maxDurationMs: args.maxDurationMs,
              retentionHours: args.retentionHours,
              variantSelector: args.variantSelector,
              allVariants: args.allVariants,
            });
            return { ok: true, action: args.action, watchId: id, status: params.streamMonitor.getStatus(id) ?? undefined };
          }
          if (args.action === "stop") {
            if (!args.watchId) return { ok: false, action: args.action };
            const stopped = params.streamMonitor.stopWatch(args.watchId);
            return { ok: stopped, action: args.action, stopped, status: params.streamMonitor.getStatus(args.watchId) ?? undefined };
          }
          if (args.action === "status") {
            if (!args.watchId) return { ok: false, action: args.action };
            const status = params.streamMonitor.getStatus(args.watchId);
            return { ok: status !== null, action: args.action, watchId: args.watchId, status: status ?? undefined };
          }
          if (args.action === "delete") {
            if (!args.watchId) return { ok: false, action: args.action };
            return params.streamMonitor.removeWatch(args.watchId).then((removed): WatchToolResult => ({
              ok: removed,
              action: args.action,
              watchId: args.watchId,
              removed,
            }));
          }
          return { ok: true, action: "list", watches: params.streamMonitor.listWatches() };
        })();
        const awaitedResult = await result;
        const textLines = [
          `ok=${awaitedResult.ok}`,
          `action=${awaitedResult.action}`,
        ];
        if (awaitedResult.watchId) textLines.push(`watchId=${awaitedResult.watchId}`);
        if (awaitedResult.stopped !== undefined) textLines.push(`stopped=${awaitedResult.stopped}`);
        if (awaitedResult.removed !== undefined) textLines.push(`removed=${awaitedResult.removed}`);
        if (awaitedResult.status) {
          const s = awaitedResult.status;
          textLines.push(
            `profile=${s.profile}`,
            `state=${s.state}`,
            `running=${s.running}`,
            `pollCount=${s.pollCount}`,
            `errorCount=${s.errorCount}`,
            `downloadedSegments=${s.downloadedSegmentCount}`,
            `analyzedSegments=${s.analyzedSegmentCount}`,
            `events=${s.events.length}`,
            `lastPollAt=${s.lastPollAt ?? "never"}`,
          );
          if (s.report?.jsonPath) textLines.push("report=available");
          if (s.events.length > 0) {
            textLines.push("detectedEvents:");
            for (const ev of s.events.slice(-10)) {
              textLines.push(`- [${ev.severity}] ${ev.code}: ${ev.summary}`);
            }
          }
        }
        if (awaitedResult.watches) {
          textLines.push(`sessions=${awaitedResult.watches.length}`);
          for (const w of awaitedResult.watches) {
            textLines.push(`- id=${w.id} profile=${w.profile} state=${w.state} running=${w.running} downloaded=${w.downloadedSegmentCount} analyzed=${w.analyzedSegmentCount} events=${w.events.length} url=${w.url}`);
          }
        }
        params.logToolEnd("video_stream_watch", intent, awaitedResult, startedAtMs);
        return { content: params.textResult(textLines.join("\n")), details: awaitedResult };
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

  const reserveStreamer = params.reserveStreamerCall ?? params.reserveToolCall;

  const streamListTool: AgentTool = {
    name: "stream_list",
    label: "Stream List",
    description:
      "Lista todos os streams clonados localmente (origins). Retorna id, sourceUrl, duracao, segmentos, variantes e se esta sendo servido com playbackUrl.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, _rawParams) => {
      const blocked = reserveStreamer("stream_list");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const intent = params.logToolStart("stream_list", {});
      try {
        const origins = await params.streamer.listOrigins();
        const list = origins.map((s) => ({
          ...s,
          serving: params.serveManager.isServing(s.id),
          servingUrl: null,
        }));
        const text = [
          `count=${list.length}`,
          ...list.map(
            (s) =>
              `- ${s.id} | serving=${s.serving}${s.servingUrl ? ` url=${s.servingUrl}` : ""} | duration=${s.cumulativeDurationSeconds}s | segments=${s.segmentCount} | variants=${s.variantCount} | source=${s.sourceUrl}`,
          ),
        ].join("\n");
        params.logToolEnd("stream_list", intent, { status: "completed", resultCount: list.length }, startedAtMs);
        return { content: params.textResult(text), details: list };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("stream_list", intent, { status: "failed", error: message }, startedAtMs);
        return { content: params.textResult(`ok=false\nerror=${message}`), details: { error: message } };
      }
    },
  };

  const streamInspectTool: AgentTool = {
    name: "stream_inspect",
    label: "Stream Inspect",
    description:
      "Inspeciona um origin clonado pelo streamer/VHS. Use quando precisar ver chunks/segments, manifest local, variants, renditions, duracao ou paths do origin. " +
      "Equivale ao endpoint GET /streams/:originId e evita procurar arquivos com exec/find.",
    parameters: {
      type: "object",
      properties: {
        originId: { type: "string", description: "ID do origin clonado" },
        maxSegments: {
          type: "number",
          description: "Numero maximo de chunks/segments a listar no texto. Padrao: 20.",
        },
      },
      required: ["originId"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = reserveStreamer("stream_inspect");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { originId: string; maxSegments?: number };
      const maxSegments = Math.max(1, Math.min(100, Math.floor(args.maxSegments ?? 20)));
      const intent = params.logToolStart("stream_inspect", args);
      try {
        const origin = await params.streamer.inspectOrigin(args.originId);
        const segments = origin.segments.slice(0, maxSegments);
        const text = [
          `ok=true`,
          `id=${origin.id}`,
          `protocol=${origin.protocol ?? "hls"}`,
          `manifestPath=${origin.manifestPath}`,
          `playbackPath=${origin.playbackPath}`,
          `duration=${origin.cumulativeDurationSeconds}s`,
          `segments=${origin.segmentCount}`,
          `variants=${origin.variantCount}`,
          `renditions=${origin.renditionCount}`,
          `bytes=${origin.bytes}`,
          `chunksListed=${segments.length}/${origin.segmentCount}`,
          ...segments.map((segment, index) =>
            [
              `- chunk[${index}]`,
              `originalIndex=${segment.originalIndex}`,
              `localUri=${segment.localUri}`,
              `duration=${segment.duration ?? "n/a"}`,
              `bytes=${segment.bytes}`,
              `source=${segment.sourceUrl}`,
            ].join(" | "),
          ),
        ].join("\n");
        params.logToolEnd(
          "stream_inspect",
          intent,
          { status: "completed", originId: origin.id, segmentCount: origin.segmentCount },
          startedAtMs,
          `stream_inspect id=${origin.id} segments=${origin.segmentCount}`,
        );
        return { content: params.textResult(text), details: origin };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("stream_inspect", intent, { status: "failed", error: message }, startedAtMs);
        return { content: params.textResult(`ok=false\nerror=${message}`), details: { error: message } };
      }
    },
  };

  const streamChunkExecTool: AgentTool = {
    name: "stream_chunk_exec",
    label: "Stream Chunk Exec",
    description:
      "Executa ffprobe ou ffmpeg contra um chunk/segment clonado, resolvendo o path por originId + targetKind + targetIndex + segmentIndex. " +
      "Use para frames, GOP, keyframes, timestamps, pacotes, extracao de frame ou qualquer analise livre de media. " +
      "Nao use exec/find para descobrir path do chunk. Passe args livres como array, usando placeholders: {chunk}=arquivo do chunk, {out}=arquivo temporario de saida, {outDir}=diretorio temporario, {originRoot}=root do origin.",
    parameters: {
      type: "object",
      properties: {
        originId: { type: "string", description: "ID do origin clonado" },
        targetKind: {
          type: "string",
          enum: ["variant", "rendition", "flat"],
          description: "Colecao onde buscar o chunk. Padrao: variant.",
        },
        targetIndex: {
          type: "number",
          description: "Indice da variant/rendition. Padrao: 0.",
        },
        segmentIndex: {
          type: "number",
          description: "Indice zero-based do chunk/segment dentro do target.",
        },
        binary: {
          type: "string",
          enum: ["ffprobe", "ffmpeg"],
          description: "Binario a executar sem shell.",
        },
        args: {
          type: "array",
          description:
            "Argumentos livres do ffprobe/ffmpeg. Use {chunk} onde entraria o path do chunk e {out}/{outDir} para outputs temporarios.",
          items: { type: "string" },
        },
        timeoutMs: { type: "number", description: "Timeout em ms. Padrao: 120000." },
        maxOutputChars: { type: "number", description: "Limite de stdout/stderr retido. Padrao: 120000." },
      },
      required: ["originId", "segmentIndex", "binary", "args"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = reserveStreamer("stream_chunk_exec");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        originId: string;
        targetKind?: "variant" | "rendition" | "flat";
        targetIndex?: number;
        segmentIndex: number;
        binary: "ffprobe" | "ffmpeg";
        args: string[];
        timeoutMs?: number;
        maxOutputChars?: number;
      };
      const intent = params.logToolStart("stream_chunk_exec", args);
      try {
        const origin = await params.streamer.inspectOrigin(args.originId);
        const result = await runStreamChunkCommand({
          origin,
          targetKind: args.targetKind,
          targetIndex: args.targetIndex,
          segmentIndex: args.segmentIndex,
          binary: args.binary,
          args: args.args,
          timeoutMs: args.timeoutMs,
          maxOutputChars: args.maxOutputChars,
        });
        const stdout = result.stdout.trim();
        const stderr = result.stderr.trim();
        const text = [
          `ok=${result.ok}`,
          `binary=${result.binary}`,
          `exitCode=${result.exitCode ?? "null"}`,
          `timedOut=${result.timedOut}`,
          `durationMs=${result.durationMs}`,
          `originId=${result.originId}`,
          `target=${result.targetKind}[${result.targetIndex}]`,
          `segmentIndex=${result.segmentIndex}`,
          `chunkPath=${result.chunkPath}`,
          `chunkLocalUri=${result.chunk.localUri}`,
          `chunkOriginalIndex=${result.chunk.originalIndex}`,
          `chunkDuration=${result.chunk.duration ?? "n/a"}`,
          `outDir=${result.outDir}`,
          `outPath=${result.outPath}`,
          `outputFiles=${result.outputFiles.length}`,
          ...(result.error ? [`error=${result.error}`] : []),
          ...(stdout ? [`stdout:\n${stdout}`] : []),
          ...(stderr ? [`stderr:\n${stderr}`] : []),
        ].join("\n");
        params.logToolEnd(
          "stream_chunk_exec",
          intent,
          {
            status: result.ok ? "completed" : "failed",
            originId: result.originId,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
          },
          startedAtMs,
          `stream_chunk_exec ${result.binary} ok=${result.ok} exitCode=${result.exitCode ?? "null"}`,
        );
        return { content: params.textResult(text), details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("stream_chunk_exec", intent, { status: "failed", error: message }, startedAtMs);
        return { content: params.textResult(`ok=false\nerror=${message}`), details: { error: message } };
      }
    },
  };

  const streamCloneTool: AgentTool = {
    name: "stream_clone",
    label: "Stream Clone",
    description:
      "Clona uma URL HLS/DASH para um origin local. Usar antes de stream_serve para disponibilizar playback local. " +
      "O clone baixa os segmentos e cria manifestos locais. Pode demorar dependendo da duracao e da rede.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL do manifesto HLS (.m3u8) ou DASH (.mpd)" },
        originId: {
          type: "string",
          description: "ID opcional para o origin. Se vazio, um UUID e gerado automaticamente.",
        },
        durationSeconds: {
          type: "number",
          description: "Duracao alvo em segundos (padrao: 60). O clone baixa segmentos ate atingir essa duracao acumulada.",
        },
        allVariants: {
          type: "boolean",
          description: "Se true, clona todas as variants/resolucoes da ladder em vez de apenas a melhor.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = reserveStreamer("stream_clone");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        url: string;
        originId?: string;
        durationSeconds?: number;
        allVariants?: boolean;
      };
      const intent = params.logToolStart("stream_clone", args);
      try {
        const isDash = args.url.trim().toLowerCase().includes(".mpd");
        const result = isDash
          ? await params.streamer.cloneDash({
              url: args.url,
              originId: args.originId,
              durationSeconds: args.durationSeconds,
              allVariants: args.allVariants,
            })
          : await params.streamer.cloneHls({
              url: args.url,
              originId: args.originId,
              durationSeconds: args.durationSeconds,
              allVariants: args.allVariants,
            });
        const text = `ok=true\nid=${result.id}`;
        params.logToolEnd("stream_clone", intent, result, startedAtMs);
        return { content: params.textResult(text), details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("stream_clone", intent, { error: message }, startedAtMs);
        return { content: params.textResult(`ok=false\nerror=${message}`), details: { error: message } };
      }
    },
  };

  const streamServeTool: AgentTool = {
    name: "stream_serve",
    label: "Stream Serve",
    description:
      "Inicia um servidor HTTP local para servir um origin clonado como VOD. " +
      "Requer que o origin exista (criado por stream_clone). Retorna a playbackUrl para usar no player.",
    parameters: {
      type: "object",
      properties: {
        originId: { type: "string", description: "ID do origin a servir" },
      },
      required: ["originId"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = reserveStreamer("stream_serve");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { originId: string };
      const intent = params.logToolStart("stream_serve", args);
      try {
        const result = await params.serveManager.serve(args.originId);
        const text = `ok=true\nplaybackUrl=${result.playbackUrl}`;
        params.logToolEnd("stream_serve", intent, result, startedAtMs);
        return { content: params.textResult(text), details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("stream_serve", intent, { error: message }, startedAtMs);
        return { content: params.textResult(`ok=false\nerror=${message}`), details: { error: message } };
      }
    },
  };

  const streamStopTool: AgentTool = {
    name: "stream_stop",
    label: "Stream Stop",
    description:
      "Para o servidor HTTP de um origin que esta sendo servido (criado por stream_serve). " +
      "O origin continua existindo no disco, apenas o servidor e derrubado.",
    parameters: {
      type: "object",
      properties: {
        originId: { type: "string", description: "ID do origin a parar" },
      },
      required: ["originId"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = reserveStreamer("stream_stop");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { originId: string };
      const intent = params.logToolStart("stream_stop", args);
      try {
        await params.serveManager.stop(args.originId);
        params.logToolEnd("stream_stop", intent, { stopped: true }, startedAtMs);
        return { content: params.textResult("ok=true\nstopped=true"), details: { stopped: true } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("stream_stop", intent, { error: message }, startedAtMs);
        return { content: params.textResult(`ok=false\nerror=${message}`), details: { error: message } };
      }
    },
  };

  return [
    videoHlsInspectTool,
    videoProbeTool,
    playbackAnalyzeTool,
    videoStreamWatchTool,
    streamListTool,
    streamInspectTool,
    streamChunkExecTool,
    streamCloneTool,
    streamServeTool,
    streamStopTool,
  ];
}
