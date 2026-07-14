import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { createKaelApp } from "../app.js";
import {
  diagnoseStreamerClone,
  renderStreamerAnalysisHtml,
  type StreamerCloneProgressEvent,
  type StreamerCloneResult,
  type StreamerFaultTargetKind,
  type StreamerOriginSummary,
} from "@gugaio/vhs";
import { formatBytes, formatSeconds, highlight, optionalNumber, optionalTimeSeconds } from "./cli-utils.js";
import {
  buildStreamerFileProbe,
  formatClonedVariantLabel,
  formatStreamerAnalyzeReport,
  formatStreamerDiagnosticSummary,
  formatStreamerOriginSummary,
  formatStreamerProbeReport,
  toStreamerProbeSummary,
} from "./streamer-output.js";


export function registerStreamerCommands(program: Command): void {
  const streamer = program
    .command("streamer")
    .description("Ferramentas locais de clone e origem de streams HLS/DASH");

  streamer
    .command("clone")
    .description("Clona uma janela VOD HLS/DASH localmente e opcionalmente serve como origem HTTP")
    .argument("<url>", "URL do manifesto HLS (.m3u8) ou DASH (.mpd)")
    .option("--format <format>", "auto, hls ou dash", "auto")
    .option("--duration <seconds>", "duracao alvo em segundos (baixa segmentos ate cumulative >= alvo)", "60")
    .option("--start <time>", "offset aproximado de inicio da janela: segundos, mm:ss ou hh:mm:ss")
    .option("--start-segment <n>", "indice zero-based do primeiro segmento original a clonar")
    .option("--segment-count <n>", "quantidade exata de segmentos a clonar a partir da janela")
    .option("--variant <selector>", "aac-highest, highest, lowest ou indice zero-based da variant", "aac-highest")
    .option("--all-variants", "clona todas as variants HLS ou Representations DASH e gera manifesto local", false)
    .option("--all-variantes", "alias de --all-variants", false)
    .option("--max-variants <n>", "limite opcional de variants quando --all-variants estiver ativo")
    .option("--live", "serve o clone como live sliding window apos clonar (implica --serve)", false)
    .option("--window-size <n>", "quantidade de segmentos na janela live quando --live estiver ativo")
    .option("--initial-media-sequence <n>", "media sequence inicial virtual quando --live estiver ativo")
    .option("--timeout-ms <ms>", "timeout de fetch para manifestos/playlists")
    .option("--segment-timeout-ms <ms>", "timeout de download por segmento (padrao: 60000)")
    .option("--segment-retries <n>", "retries por segmento apos a primeira tentativa (padrao: 2)")
    .option("--max-segments <n>", "limite de segmentos lidos do manifesto de media")
    .option("--id <id>", "id seguro para o origin local")
    .option("--serve", "inicia servidor HTTP local com CORS apos clonar", false)
    .option("--host <host>", "host do servidor quando --serve estiver ativo", "127.0.0.1")
    .option("--port <port>", "porta do servidor quando --serve estiver ativo (0 = aleatoria)", "0")
    .action(async (url: string, options: StreamerCloneOptions) => {
      await commandStreamerClone(url, options);
    });

  streamer
    .command("list")
    .description("Lista origins HLS/DASH clonados localmente")
    .action(async () => {
      await commandStreamerList();
    });

  streamer
    .command("serve")
    .description("Serve um origin clonado existente como VOD local")
    .argument("[originId]", "id do origin criado por streamer clone/mutate ou latest", "latest")
    .option("--host <host>", "host do servidor VOD", "127.0.0.1")
    .option("--port <port>", "porta do servidor VOD (0 = aleatoria)", "0")
    .action(async (originId: string | undefined, options: StreamerServeOptions) => {
      await commandStreamerServe(originId, options);
    });

  streamer
    .command("live")
    .description("Serve um origin clonado como live HLS com sliding window virtual")
    .argument("[originId]", "id do origin criado por streamer clone ou latest", "latest")
    .option("--window-size <n>", "quantidade de segmentos na janela live", "5")
    .option("--initial-media-sequence <n>", "media sequence inicial virtual", "100000")
    .option("--host <host>", "host do servidor live", "127.0.0.1")
    .option("--port <port>", "porta do servidor live (0 = aleatoria)", "0")
    .action(async (originId: string | undefined, options: StreamerLiveOptions) => {
      await commandStreamerLive(originId, options);
    });

  streamer
    .command("inspect")
    .description("Mostra metadados de um origin HLS/DASH clonado")
    .argument("<originId>", "id do origin criado por streamer clone ou latest")
    .action(async (originId: string) => {
      await commandStreamerInspect(originId);
    });

  streamer
    .command("probe")
    .description("Valida arquivos locais e compatibilidade basica de playback de um origin")
    .argument("[originId]", "id do origin criado por streamer clone ou latest", "latest")
    .action(async (originId: string | undefined) => {
      await commandStreamerProbe(originId);
    });

  streamer
    .command("analyze")
    .description("Analisa segmentos locais amostrados com ffprobe para PTS, duracao e keyframes")
    .argument("[originId]", "id do origin criado por streamer clone ou latest", "latest")
    .option("--timeout-ms <ms>", "timeout de ffprobe por segmento")
    .option("--max-media-playlists <n>", "quantidade maxima de playlists consideradas")
    .option("--max-segments-per-playlist <n>", "quantidade maxima de segmentos amostrados por playlist", "3")
    .option("--start-segment <n>", "indice zero-based do primeiro segmento original a analisar")
    .option("--segment-count <n>", "quantidade de segmentos originais a analisar a partir de --start-segment")
    .option("--full", "analisa todos os segmentos das playlists consideradas", false)
    .option("--html", "gera um relatorio HTML estatico", false)
    .option("--output <path>", "caminho do relatorio HTML")
    .option("--json", "imprime o relatorio completo em JSON", false)
    .action(async (originId: string | undefined, options: StreamerAnalyzeOptions) => {
      await commandStreamerAnalyze(originId, options);
    });

  streamer
    .command("mutate")
    .description("Cria um novo origin derivado com uma fault injetada para teste de players")
    .argument("[originId]", "id do origin base criado por streamer clone ou latest", "latest")
    .option("--fault <type>", "tipo de fault a injetar (discontinuity, segment-swap)", "discontinuity")
    .option("--at-segment <n>", "indice zero-based do segmento alvo")
    .option("--target <kind>", "playlist alvo: variant ou rendition", "variant")
    .option("--target-index <n>", "indice zero-based da variant/rendition alvo", "0")
    .option("--with-origin <originId>", "origin donor usado por faults como segment-swap")
    .option("--with-target <kind>", "playlist donor: variant ou rendition")
    .option("--with-target-index <n>", "indice zero-based da variant/rendition donor")
    .option("--with-segment <n>", "indice zero-based do segmento donor")
    .option("--with-discontinuity", "insere EXT-X-DISCONTINUITY apos aplicar a fault", false)
    .option("--ffmpeg-profile <profile>", "transcode do donor antes do swap (hevc)")
    .option("--id <id>", "id seguro para o novo origin derivado")
    .action(async (originId: string | undefined, options: StreamerMutateOptions) => {
      await commandStreamerMutate(originId, options);
    });

  streamer
    .command("remove")
    .description("Remove um origin HLS/DASH clonado do storage local")
    .argument("<originId>", "id do origin criado por streamer clone")
    .option("--yes", "confirma a remocao do diretorio do origin", false)
    .action(async (originId: string, options: StreamerRemoveOptions) => {
      await commandStreamerRemove(originId, options);
    });

}

type StreamerCloneOptions = {
  format?: string;
  duration?: string;
  start?: string;
  startSegment?: string;
  segmentCount?: string;
  variant?: string;
  allVariants?: boolean;
  allVariantes?: boolean;
  maxVariants?: string;
  live?: boolean;
  windowSize?: string;
  initialMediaSequence?: string;
  timeoutMs?: string;
  segmentTimeoutMs?: string;
  segmentRetries?: string;
  maxSegments?: string;
  id?: string;
  serve?: boolean;
  host?: string;
  port?: string;
};

type StreamerLiveOptions = {
  windowSize?: string;
  initialMediaSequence?: string;
  host?: string;
  port?: string;
};

type StreamerServeOptions = {
  host?: string;
  port?: string;
};

type StreamerRemoveOptions = {
  yes?: boolean;
};

type StreamerAnalyzeOptions = {
  timeoutMs?: string;
  maxMediaPlaylists?: string;
  maxSegmentsPerPlaylist?: string;
  startSegment?: string;
  segmentCount?: string;
  full?: boolean;
  html?: boolean;
  output?: string;
  json?: boolean;
};

type StreamerMutateOptions = {
  fault?: string;
  atSegment?: string;
  target?: string;
  targetIndex?: string;
  withOrigin?: string;
  withTarget?: string;
  withTargetIndex?: string;
  withSegment?: string;
  withDiscontinuity?: boolean;
  ffmpegProfile?: string;
  id?: string;
};

function createStreamerProgressLogger(): (event: StreamerCloneProgressEvent) => void {
  return (event) => {
    switch (event.type) {
      case "start":
        console.error(
          `[streamer] criando origin ${event.originId} | start=${formatSeconds(event.startSeconds)}${event.startSegment !== undefined ? ` | startSegment=${event.startSegment}` : ""}${event.segmentCount !== undefined ? ` | segmentCount=${event.segmentCount}` : ""} | duration=${event.durationSeconds}s | allVariants=${event.allVariants}`,
        );
        return;
      case "manifest_fetch":
        console.error(`[streamer] inspecionando manifest: ${event.url}`);
        return;
      case "manifest_ready":
        console.error(
          `[streamer] manifest ${event.playlistType} pronto | variants=${event.variantCount} | segments=${event.segmentCount}`,
        );
        return;
      case "variant_inspect":
        console.error(
          `[streamer] inspecionando variant ${event.variantIndex + 1}/${event.variantCount}: ${event.label}`,
        );
        return;
      case "variant_ready":
        console.error(
          `[streamer] variant ${event.variantIndex + 1}/${event.variantCount} pronta: ${event.label} | segments=${event.segmentCount} | target=${event.targetDuration}s`,
        );
        return;
      case "segment_download_start":
        console.error(
          `[streamer] baixando segmento ${event.segmentIndex + 1}/${event.segmentCount}${event.originalSegmentIndex !== undefined ? ` | original=${event.originalSegmentIndex}` : ""} da variant ${event.variantIndex + 1}/${event.variantCount}${event.duration ? ` | ${event.duration.toFixed(3)}s` : ""}`,
        );
        return;
      case "segment_download_retry":
        console.error(
          `[streamer] retry segmento ${event.segmentIndex + 1}/${event.segmentCount}${event.originalSegmentIndex !== undefined ? ` | original=${event.originalSegmentIndex}` : ""} da variant ${event.variantIndex + 1}/${event.variantCount} | tentativa ${event.attempt}/${event.maxAttempts} | ${event.error}`,
        );
        return;
      case "segment_downloaded":
        console.error(
          `[streamer] ok segmento ${event.segmentIndex + 1}/${event.segmentCount}${event.originalSegmentIndex !== undefined ? ` | original=${event.originalSegmentIndex}` : ""} | ${formatBytes(event.bytes)} | total=${formatBytes(event.cumulativeBytes)} | duration=${event.cumulativeDurationSeconds.toFixed(3)}s`,
        );
        return;
      case "complete":
        console.error(
          `[streamer] clone completo ${event.originId} | variants=${event.variantCount} | segments=${event.segmentCount} | bytes=${formatBytes(event.bytes)} | duration=${event.cumulativeDurationSeconds.toFixed(3)}s`,
        );
        return;
    }
  };
}


async function commandStreamerList(): Promise<void> {
  const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
  const origins = await app.streamer.listOrigins();

  if (origins.length === 0) {
    console.log("Nenhum origin streamer encontrado.");
    return;
  }

  for (const origin of origins) {
    console.log(formatStreamerOriginSummary(origin));
  }
}

async function resolveStreamerOriginId(
  streamer: { listOrigins(): Promise<StreamerOriginSummary[]> },
  requestedOriginId: string | undefined,
): Promise<string> {
  const requested = requestedOriginId?.trim() || "latest";
  if (requested !== "latest") {
    return requested;
  }

  const origins = await streamer.listOrigins();
  const latest = origins[0];
  if (!latest) {
    throw new Error("nenhum origin streamer encontrado para usar como latest");
  }
  return latest.id;
}

async function commandStreamerInspect(originId: string): Promise<void> {
  const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
  const resolvedOriginId = await resolveStreamerOriginId(app.streamer, originId);
  const origin: StreamerCloneResult = await app.streamer.inspectOrigin(resolvedOriginId);
  const selectedVariant = origin.selectedVariant
    ? `${origin.selectedVariant.resolution ?? "unknown"} @ ${origin.selectedVariant.bandwidth ?? "n/a"}bps`
    : "media playlist direta ou ladder completa";
  const lines = [
    `${highlight("streamer origin")}: ${origin.id}`,
    `schemaVersion=${origin.schemaVersion}`,
    `protocol=${origin.protocol ?? "hls"}`,
    `created=${origin.createdAt}`,
    ...(origin.derivedFrom ? [`derivedFrom=${origin.derivedFrom}`] : []),
    ...(origin.faults && origin.faults.length > 0
      ? [
          "faults:",
          ...origin.faults.map(
            (fault, index) =>
              `- [${index}] ${fault.type} | target=${fault.targetKind}[${fault.targetIndex}] | segment=${fault.segmentIndex} | ${fault.description}`,
          ),
        ]
      : []),
    `source=${origin.sourceUrl}`,
    `selected=${origin.selectedUrl}`,
    `final=${origin.finalUrl}`,
    `variant=${selectedVariant}`,
    `allVariants=${origin.allVariants}`,
    `variants=${origin.variantCount}`,
    `renditions=${origin.renditionCount}`,
    `segments=${origin.segmentCount}`,
    `window=${formatSeconds(origin.requestedStartSeconds ?? 0)} -> ${formatSeconds((origin.requestedStartSeconds ?? 0) + origin.requestedDurationSeconds)}`,
    ...(origin.requestedStartSegment !== undefined || origin.requestedSegmentCount !== undefined
      ? [
          `segmentWindow=${origin.requestedStartSegment ?? 0} -> ${
            (origin.requestedStartSegment ?? 0) + (origin.requestedSegmentCount ?? origin.segmentCount)
          }`,
        ]
      : []),
    `duration=${formatSeconds(origin.cumulativeDurationSeconds)} requested=${origin.requestedDurationSeconds}s reached=${origin.reachedTargetDuration}`,
    `targetDuration=${origin.targetDuration}s`,
    `bytes=${formatBytes(origin.bytes)}`,
    `manifest=${origin.manifestPath}`,
    `root=${origin.rootDir}`,
    `playbackPath=${origin.playbackPath}`,
    "variantsDetail:",
    ...origin.variants.map(
      (variant, index) =>
        `- [${index}] ${formatClonedVariantLabel(variant)} | local=${variant.localUri} | segments=${variant.segmentCount} | maps=${variant.maps.length} | duration=${formatSeconds(variant.cumulativeDurationSeconds)} | bytes=${formatBytes(variant.bytes)}`,
    ),
    ...(origin.renditions.length > 0
      ? [
          "renditions:",
          ...origin.renditions.map(
            (rendition, index) =>
              `- [${index}] ${rendition.type.toUpperCase()} | ${rendition.groupId ?? "unknown"} | ${rendition.name ?? "unnamed"} | local=${rendition.localUri} | segments=${rendition.segmentCount} | maps=${rendition.maps.length} | duration=${formatSeconds(rendition.cumulativeDurationSeconds)} | bytes=${formatBytes(rendition.bytes)}`,
          ),
        ]
      : []),
  ];

  console.log(lines.join("\n"));
}

async function commandStreamerProbe(originId: string | undefined): Promise<void> {
  const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
  const resolvedOriginId = await resolveStreamerOriginId(app.streamer, originId);
  const origin: StreamerCloneResult = await app.streamer.inspectOrigin(resolvedOriginId);
  const diagnostic = diagnoseStreamerClone(origin);
  const fileProbe = await buildStreamerFileProbe(origin);
  const ffprobeReport = await app.streamer.probeOrigin(resolvedOriginId);

  console.log(formatStreamerProbeReport(origin, diagnostic, fileProbe, ffprobeReport).join("\n"));
}

async function commandStreamerAnalyze(originId: string | undefined, options: StreamerAnalyzeOptions): Promise<void> {
  const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
  const resolvedOriginId = await resolveStreamerOriginId(app.streamer, originId);
  const timeoutMs = optionalNumber(options.timeoutMs, "--timeout-ms");
  const maxMediaPlaylists = optionalNumber(options.maxMediaPlaylists, "--max-media-playlists");
  const maxSegmentsPerPlaylist = optionalNumber(options.maxSegmentsPerPlaylist, "--max-segments-per-playlist");
  const startSegment = optionalNumber(options.startSegment, "--start-segment");
  const segmentCount = optionalNumber(options.segmentCount, "--segment-count");
  const report = await app.streamer.analyzeOrigin(resolvedOriginId, {
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
    ...(Number.isFinite(maxMediaPlaylists) ? { maxMediaPlaylists } : {}),
    ...(Number.isFinite(maxSegmentsPerPlaylist) ? { maxSegmentsPerPlaylist } : {}),
    ...(Number.isFinite(startSegment) ? { startSegment } : {}),
    ...(Number.isFinite(segmentCount) ? { segmentCount } : {}),
    ...(options.full ? { full: true } : {}),
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatStreamerAnalyzeReport(report).join("\n"));
  if (options.html) {
    const origin = await app.streamer.inspectOrigin(resolvedOriginId);
    const outputPath = options.output?.trim()
      ? path.resolve(options.output.trim())
      : path.join(origin.rootDir, "analysis.html");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, renderStreamerAnalysisHtml(report), "utf-8");
    console.log(`html=${outputPath}`);
  }
}

async function commandStreamerMutate(originId: string | undefined, options: StreamerMutateOptions): Promise<void> {
  const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
  const resolvedOriginId = await resolveStreamerOriginId(app.streamer, originId);
  const fault = (options.fault?.trim() || "discontinuity").toLowerCase();
  if (fault !== "discontinuity" && fault !== "segment-swap") {
    throw new Error("faults suportadas nesta fase: discontinuity, segment-swap");
  }
  const ffmpegProfile = options.ffmpegProfile?.trim().toLowerCase();
  if (ffmpegProfile && ffmpegProfile !== "hevc") {
    throw new Error("--ffmpeg-profile suporta apenas hevc nesta fase");
  }
  if (ffmpegProfile && fault !== "segment-swap") {
    throw new Error("--ffmpeg-profile so pode ser usado com --fault segment-swap");
  }
  const segmentIndex = optionalNumber(options.atSegment, "--at-segment");
  if (!Number.isFinite(segmentIndex)) {
    throw new Error("use --at-segment <n> para escolher o segmento alvo");
  }
  const target = (options.target?.trim() || "variant").toLowerCase();
  if (target !== "variant" && target !== "rendition") {
    throw new Error("--target deve ser variant ou rendition");
  }
  const targetIndex = optionalNumber(options.targetIndex, "--target-index");
  const donorTarget = (options.withTarget?.trim() || target).toLowerCase();
  if (donorTarget !== "variant" && donorTarget !== "rendition") {
    throw new Error("--with-target deve ser variant ou rendition");
  }
  const donorTargetIndex = optionalNumber(options.withTargetIndex, "--with-target-index");
  const donorSegmentIndex = optionalNumber(options.withSegment, "--with-segment");
  const result = await app.streamer.mutateOrigin({
    originId: resolvedOriginId,
    fault: fault as "discontinuity" | "segment-swap",
    targetKind: target as StreamerFaultTargetKind,
    targetIndex: Number.isFinite(targetIndex) ? targetIndex : 0,
    segmentIndex: segmentIndex as number,
    ...(options.withOrigin?.trim() ? { donorOriginId: options.withOrigin.trim() } : {}),
    ...(Number.isFinite(donorTargetIndex) ? { donorTargetIndex } : {}),
    ...(Number.isFinite(donorSegmentIndex) ? { donorSegmentIndex } : {}),
    ...(options.withOrigin?.trim() ? { donorTargetKind: donorTarget as StreamerFaultTargetKind } : {}),
    ...(options.withDiscontinuity ? { withDiscontinuity: true } : {}),
    ...(ffmpegProfile ? { ffmpegProfile: ffmpegProfile as "hevc" } : {}),
    ...(options.id?.trim() ? { newOriginId: options.id.trim() } : {}),
  });

  console.log(`${highlight("streamer origin mutated")}: ${result.origin.id}`);
  console.log(`source=${result.sourceOriginId}`);
  console.log(`fault=${result.fault.type} target=${result.fault.targetKind}[${result.fault.targetIndex}] segment=${result.fault.segmentIndex}`);
  if (result.fault.donorOriginId) {
    console.log(`donor=${result.fault.donorOriginId} ${result.fault.donorTargetKind}[${result.fault.donorTargetIndex}] segment=${result.fault.donorSegmentIndex}`);
  }
  if (result.fault.withDiscontinuity) {
    console.log("withDiscontinuity=yes");
  }
  if (ffmpegProfile) {
    console.log(`ffmpegProfile=${ffmpegProfile}`);
  }
  console.log(`description=${result.fault.description}`);
  console.log(`manifest=${result.origin.manifestPath}`);
  console.log(`root=${result.origin.rootDir}`);
}

async function commandStreamerRemove(originId: string, options: StreamerRemoveOptions): Promise<void> {
  if (!options.yes) {
    throw new Error("use --yes para confirmar a remocao do origin streamer");
  }

  const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
  const result = await app.streamer.removeOrigin(originId);
  console.log(`${highlight("streamer origin removed")}: ${result.id}`);
  console.log(`root=${result.rootDir}`);
}

async function commandStreamerClone(url: string, options: StreamerCloneOptions): Promise<void> {
  const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
  const durationSeconds = optionalNumber(options.duration, "--duration");
  const startSeconds = optionalTimeSeconds(options.start, "--start");
  const startSegment = optionalNumber(options.startSegment, "--start-segment");
  const segmentCount = optionalNumber(options.segmentCount, "--segment-count");
  const timeoutMs = optionalNumber(options.timeoutMs, "--timeout-ms");
  const segmentTimeoutMs = optionalNumber(options.segmentTimeoutMs, "--segment-timeout-ms");
  const segmentRetries = optionalNumber(options.segmentRetries, "--segment-retries");
  const maxSegments = optionalNumber(options.maxSegments, "--max-segments");
  const maxVariants = optionalNumber(options.maxVariants, "--max-variants");
  const windowSize = optionalNumber(options.windowSize, "--window-size");
  const initialMediaSequence = optionalNumber(options.initialMediaSequence, "--initial-media-sequence");
  const port = optionalNumber(options.port, "--port");
  const allVariants = Boolean(options.allVariants || options.allVariantes);
  const logProgress = createStreamerProgressLogger();
  const format = resolveStreamerCloneFormat(url, options.format);
  if (Number.isFinite(startSeconds) && Number.isFinite(startSegment)) {
    throw new Error("use --start ou --start-segment, nao ambos");
  }
  if (format === "dash" && options.live) {
    throw new Error("streamer live ainda suporta apenas origins HLS; use --serve para DASH VOD local");
  }
  const cloneInput = {
    url,
    format,
    ...(Number.isFinite(durationSeconds) ? { durationSeconds } : {}),
    ...(Number.isFinite(startSeconds) ? { startSeconds } : {}),
    ...(Number.isFinite(startSegment) ? { startSegment } : {}),
    ...(Number.isFinite(segmentCount) ? { segmentCount } : {}),
    ...(options.variant?.trim() ? { variant: options.variant.trim() } : {}),
    ...(allVariants ? { allVariants: true } : {}),
    ...(Number.isFinite(maxVariants) ? { maxVariants } : {}),
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
    ...(Number.isFinite(segmentTimeoutMs) ? { segmentTimeoutMs } : {}),
    ...(Number.isFinite(segmentRetries) ? { segmentRetries } : {}),
    ...(Number.isFinite(maxSegments) ? { maxSegments } : {}),
    ...(options.id?.trim() ? { originId: options.id.trim() } : {}),
    onProgress: logProgress,
  } satisfies Parameters<typeof app.streamer.cloneHls>[0];
  const result = format === "dash"
    ? await app.streamer.cloneDash(cloneInput)
    : await app.streamer.cloneHls(cloneInput);

  const variantText = result.allVariants
    ? `all variants (${result.variantCount})`
    : result.selectedVariant
    ? `${result.selectedVariant.resolution ?? "unknown"} @ ${result.selectedVariant.bandwidth ?? "n/a"}bps`
    : "media playlist direta";
  const diagnostic = diagnoseStreamerClone(result);
  const fileProbe = await buildStreamerFileProbe(result);
  const ffprobeReport = await app.streamer.probeOrigin(result.id);

  console.log(
    [
      `${highlight("streamer origin cloned")}: ${result.id}`,
      `protocol=${result.protocol ?? format}`,
      `source=${result.sourceUrl}`,
      `selected=${result.selectedUrl}`,
      `variant=${variantText}`,
      `variants=${result.variantCount}`,
      `segments=${result.segmentCount}`,
      `window=${formatSeconds(result.requestedStartSeconds ?? 0)} -> ${formatSeconds((result.requestedStartSeconds ?? 0) + result.requestedDurationSeconds)}`,
      ...(result.requestedStartSegment !== undefined || result.requestedSegmentCount !== undefined
        ? [
            `segmentWindow=${result.requestedStartSegment ?? 0} -> ${
              (result.requestedStartSegment ?? 0) + (result.requestedSegmentCount ?? result.segmentCount)
            }`,
          ]
        : []),
      `duration=${result.cumulativeDurationSeconds.toFixed(3)}s requested=${result.requestedDurationSeconds}s reached=${result.reachedTargetDuration}`,
      `bytes=${formatBytes(result.bytes)}`,
      `manifest=${result.manifestPath}`,
      `root=${result.rootDir}`,
      ...formatStreamerDiagnosticSummary(diagnostic, fileProbe, toStreamerProbeSummary(ffprobeReport)),
    ].join("\n"),
  );

  if (!options.serve) {
    if (!options.live) {
      return;
    }
  }

  if (options.live) {
    const handle = await app.streamer.serveLiveOrigin(result.id, {
      host: options.host?.trim() || "127.0.0.1",
      ...(Number.isFinite(port) ? { port } : {}),
      ...(Number.isFinite(windowSize) ? { windowSize } : {}),
      ...(Number.isFinite(initialMediaSequence) ? { initialMediaSequence } : {}),
    });

    console.log(`${highlight("live origin serving")}: ${handle.playbackUrl}`);
    console.log(`windowSize=${handle.windowSize} initialMediaSequence=${handle.initialMediaSequence}`);
    await waitForStreamerStop(handle.close);
    return;
  }

  const handle = await app.streamer.serveOrigin(result.id, {
    host: options.host?.trim() || "127.0.0.1",
    ...(Number.isFinite(port) ? { port } : {}),
  });

  console.log(`${highlight("origin serving")}: ${handle.playbackUrl}`);
  await waitForStreamerStop(handle.close);
}

function resolveStreamerCloneFormat(url: string, rawFormat: string | undefined): "hls" | "dash" {
  const normalized = rawFormat?.trim().toLowerCase() || "auto";
  if (normalized === "hls" || normalized === "dash") {
    return normalized;
  }
  if (normalized !== "auto") {
    throw new Error("--format deve ser auto, hls ou dash");
  }
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  return pathname.endsWith(".mpd") ? "dash" : "hls";
}

async function commandStreamerLive(originId: string | undefined, options: StreamerLiveOptions): Promise<void> {
  const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
  const resolvedOriginId = await resolveStreamerOriginId(app.streamer, originId);
  const port = optionalNumber(options.port, "--port");
  const windowSize = optionalNumber(options.windowSize, "--window-size");
  const initialMediaSequence = optionalNumber(options.initialMediaSequence, "--initial-media-sequence");
  const handle = await app.streamer.serveLiveOrigin(resolvedOriginId, {
    host: options.host?.trim() || "127.0.0.1",
    ...(Number.isFinite(port) ? { port } : {}),
    ...(Number.isFinite(windowSize) ? { windowSize } : {}),
    ...(Number.isFinite(initialMediaSequence) ? { initialMediaSequence } : {}),
  });

  console.log(`${highlight("live origin serving")}: ${handle.playbackUrl}`);
  console.log(`origin=${handle.originId} windowSize=${handle.windowSize} initialMediaSequence=${handle.initialMediaSequence}`);
  await waitForStreamerStop(handle.close);
}

async function commandStreamerServe(originId: string | undefined, options: StreamerServeOptions): Promise<void> {
  const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
  const resolvedOriginId = await resolveStreamerOriginId(app.streamer, originId);
  const port = optionalNumber(options.port, "--port");
  const handle = await app.streamer.serveOrigin(resolvedOriginId, {
    host: options.host?.trim() || "127.0.0.1",
    ...(Number.isFinite(port) ? { port } : {}),
  });

  console.log(`${highlight("origin serving")}: ${handle.playbackUrl}`);
  console.log(`origin=${handle.originId}`);
  await waitForStreamerStop(handle.close);
}

async function waitForStreamerStop(close: () => Promise<void>): Promise<void> {
  console.log("Pressione Ctrl+C para parar.");
  const stop = async () => {
    await close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });

  await new Promise<void>(() => undefined);
}
