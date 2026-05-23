import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { VideoHlsInspectResult, VideoInspectToolService } from "./inspect-service.js";
import { isBrowserSafeHlsVariant } from "./streamer-diagnostics.js";
import type {
  StreamerAnalyzeOptions,
  StreamerCloneInput,
  StreamerCloneProgressEvent,
  StreamerCloneResult,
  StreamerClonedMap,
  StreamerClonedRendition,
  StreamerClonedSegment,
  StreamerClonedVariant,
  StreamerLiveServeHandle,
  StreamerLiveServeOptions,
  StreamerAvAlignmentSummary,
  StreamerMediaAnalysisSummary,
  StreamerMutateInput,
  StreamerMutateResult,
  StreamerOriginFault,
  StreamerOriginAnalysisReport,
  StreamerOriginProbeReport,
  StreamerOriginSummary,
  StreamerProbeOptions,
  StreamerRemoveResult,
  StreamerServeHandle,
  StreamerServeOptions,
} from "./types.js";

type HlsInspectLike = Pick<VideoInspectToolService, "inspectHls"> &
  Partial<Pick<VideoInspectToolService, "probe">>;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type SelectedMediaPlaylist = {
  inspected: VideoHlsInspectResult;
  selectedVariant?: StreamerCloneResult["selectedVariant"];
};

type VariantSource = NonNullable<StreamerClonedVariant["variant"]>;
type RenditionSource = VideoHlsInspectResult["renditions"][number];
type RenditionKind = "AUDIO" | "SUBTITLES";
type RenditionRef = {
  kind: RenditionKind;
  routeIndex: number;
  globalIndex: number;
  rendition: StreamerClonedRendition;
};
type StreamerProbeCandidate = {
  kind: "variant" | "rendition";
  index: number;
  type: "VIDEO" | RenditionKind;
  label: string;
  manifestPath: string;
};
type StreamerAnalyzeCandidate = StreamerProbeCandidate & {
  rootPath: string;
  segments: StreamerClonedSegment[];
};
type ClonedMediaSource = {
  localUri: string;
  targetDuration: number;
  segments: StreamerClonedSegment[];
};
type ProgressEmitter = (event: StreamerCloneProgressEvent) => void;

const RENDITION_KIND_CONFIG: Record<RenditionKind, { dir: "audio" | "subtitles"; route: "audio" | "subtitles" }> = {
  AUDIO: {
    dir: "audio",
    route: "audio",
  },
  SUBTITLES: {
    dir: "subtitles",
    route: "subtitles",
  },
};

const DEFAULT_DURATION_SECONDS = 60;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SEGMENT_TIMEOUT_MS = 60_000;
const DEFAULT_SEGMENT_RETRIES = 2;
const DEFAULT_MAX_SEGMENTS = 200;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PROBE_MEDIA_PLAYLISTS = 4;
const DEFAULT_MAX_ANALYZE_SEGMENTS_PER_PLAYLIST = 3;
const DURATION_DELTA_WARN_SECONDS = 0.150;
const BOUNDARY_DELTA_WARN_SECONDS = 0.250;
const AUDIO_TIMESTAMP_DELTA_WARN_SECONDS = 0.050;
const AV_TIMELINE_DRIFT_WARN_SECONDS = 0.250;
const MAX_AV_TIMELINE_DRIFT_WINDOWS = 20;
const GOP_GAP_WARN_SECONDS = 3.000;
const DEFAULT_LIVE_WINDOW_SIZE = 5;
const DEFAULT_INITIAL_MEDIA_SEQUENCE = 100_000;
const STREAMER_ORIGIN_SCHEMA_VERSION = 2;

export class StreamerService {
  constructor(
    private readonly inspect: HlsInspectLike,
    private readonly rootDir: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async listOrigins(): Promise<StreamerOriginSummary[]> {
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true }).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    });
    const origins: StreamerOriginSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      try {
        const clone = await this.loadCloneResult(entry.name);
        origins.push(toOriginSummary(clone));
      } catch {
        // Keep list resilient if a partially-written/corrupt origin exists.
      }
    }

    return origins.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async inspectOrigin(originId: string): Promise<StreamerCloneResult> {
    return this.loadCloneResult(originId);
  }

  async mutateOrigin(input: StreamerMutateInput): Promise<StreamerMutateResult> {
    const source = await this.loadCloneResult(input.originId);
    const newId = sanitizeOriginId(input.newOriginId?.trim() || randomUUID());
    const newRootDir = path.join(this.rootDir, newId);
    if (newId === source.id || await pathExists(newRootDir)) {
      throw new Error(`streamer origin ${newId} already exists`);
    }
    await fs.cp(source.rootDir, newRootDir, { recursive: true, errorOnExist: false, force: true });

    const mutated = rebaseCloneResult(source, newId, newRootDir);
    const targetKind = input.targetKind ?? "variant";
    const targetIndex = Math.max(0, Math.floor(input.targetIndex ?? 0));
    const segmentIndex = Math.max(0, Math.floor(input.segmentIndex));
    const target = resolveMutationTarget(mutated, targetKind, targetIndex);
    if (segmentIndex >= target.segments.length) {
      throw new Error(`${targetKind}[${targetIndex}] has no segment ${segmentIndex}`);
    }
    const createdAt = new Date().toISOString();
    let fault: StreamerOriginFault;

    switch (input.fault) {
      case "discontinuity":
        await injectDiscontinuityIntoManifest(target.manifestPath, segmentIndex);
        fault = {
          type: "discontinuity",
          targetKind,
          targetIndex,
          segmentIndex,
          description: `Inserted EXT-X-DISCONTINUITY before ${targetKind}[${targetIndex}] segment ${segmentIndex}`,
          createdAt,
        };
        break;
      case "segment-swap":
        fault = await applySegmentSwapMutation({
          source,
          mutated,
          targetKind,
          targetIndex,
          segmentIndex,
          donorOriginId: input.donorOriginId,
          donorTargetKind: input.donorTargetKind,
          donorTargetIndex: input.donorTargetIndex,
          donorSegmentIndex: input.donorSegmentIndex,
          withDiscontinuity: input.withDiscontinuity,
          ffmpegProfile: input.ffmpegProfile,
          createdAt,
        });
        break;
      default:
        throw new Error(`unsupported streamer fault: ${input.fault}`);
    }

    mutated.derivedFrom = source.id;
    mutated.faults = [...(source.faults ?? []), fault];
    mutated.createdAt = createdAt;
    mutated.segments = mutated.variants.flatMap((variant) => variant.segments);

    await fs.writeFile(path.join(newRootDir, "origin.json"), `${JSON.stringify(mutated, null, 2)}\n`, "utf-8");
    return {
      sourceOriginId: source.id,
      origin: mutated,
      fault,
    };
  }

  async probeOrigin(originId: string, options: StreamerProbeOptions = {}): Promise<StreamerOriginProbeReport> {
    if (!this.inspect.probe) {
      throw new Error("streamer probe requires ffprobe support in VideoInspectToolService");
    }

    const clone = await this.loadCloneResult(originId);
    const timeoutMs = normalizePositiveNumber(options.timeoutMs, DEFAULT_PROBE_TIMEOUT_MS, 1_000, 120_000);
    const maxMediaPlaylists = Math.floor(
      normalizePositiveNumber(
        options.maxMediaPlaylists,
        DEFAULT_MAX_PROBE_MEDIA_PLAYLISTS,
        1,
        32,
      ),
    );
    const candidates = buildProbeCandidates(clone).slice(0, maxMediaPlaylists);
    const entries: StreamerOriginProbeReport["entries"] = [];

    for (const candidate of candidates) {
      const result = await this.inspect.probe({
        input: candidate.manifestPath,
        timeoutMs,
      });
      entries.push({
        kind: candidate.kind,
        index: candidate.index,
        type: candidate.type,
        label: candidate.label,
        manifestPath: candidate.manifestPath,
        ok: result.ok,
        streamCount: Array.isArray(result.streams) ? result.streams.length : 0,
        errors: result.errors,
      });
    }

    const okCount = entries.filter((entry) => entry.ok).length;
    return {
      originId: clone.id,
      ok: entries.every((entry) => entry.ok),
      sampledMediaPlaylists: entries.length,
      totalMediaPlaylists: clone.variantCount + clone.renditionCount,
      okCount,
      failedCount: entries.length - okCount,
      entries,
    };
  }

  async analyzeOrigin(originId: string, options: StreamerAnalyzeOptions = {}): Promise<StreamerOriginAnalysisReport> {
    if (!this.inspect.probe) {
      throw new Error("streamer analyze requires ffprobe support in VideoInspectToolService");
    }

    const clone = await this.loadCloneResult(originId);
    const timeoutMs = normalizePositiveNumber(options.timeoutMs, DEFAULT_PROBE_TIMEOUT_MS, 1_000, 120_000);
    const maxMediaPlaylists = Math.floor(
      normalizePositiveNumber(
        options.maxMediaPlaylists,
        DEFAULT_MAX_PROBE_MEDIA_PLAYLISTS,
        1,
        32,
      ),
    );
    const maxSegmentsPerPlaylist = options.full
      ? Number.POSITIVE_INFINITY
      : Math.floor(
          normalizePositiveNumber(
            options.maxSegmentsPerPlaylist,
            DEFAULT_MAX_ANALYZE_SEGMENTS_PER_PLAYLIST,
            1,
            8,
          ),
        );
    const candidates = buildAnalyzeCandidates(clone).slice(0, maxMediaPlaylists);
    const entries: StreamerOriginAnalysisReport["entries"] = [];

    for (const candidate of candidates) {
      const candidateEntries: StreamerOriginAnalysisReport["entries"] = [];
      for (const segmentIndex of sampleSegmentIndices(candidate.segments.length, maxSegmentsPerPlaylist)) {
        const segment = candidate.segments[segmentIndex];
        const localPath = path.join(candidate.rootPath, segment.localUri);
        const streamSelector = probeStreamSelectorFor(candidate.type);
        const result = await this.inspect.probe({
          input: localPath,
          timeoutMs,
          timeline: true,
          streamSelector,
        });
        const actualDurationSeconds = extractProbeDurationSeconds(result.format);
        const streamMetadata = extractProbeStreamMetadata(result.streams);
        candidateEntries.push({
          kind: candidate.kind,
          mediaIndex: candidate.index,
          segmentIndex,
          type: candidate.type,
          label: candidate.label,
          localPath,
          timelineStartSeconds: segment.timelineStartSeconds,
          timelineEndSeconds: segment.timelineEndSeconds,
          declaredDurationSeconds: segment.duration,
          actualDurationSeconds,
          durationDeltaSeconds: calculateDurationDelta(segment.duration, actualDurationSeconds),
          streamCount: Array.isArray(result.streams) ? result.streams.length : 0,
          codecName: streamMetadata.codecName,
          sampleRate: streamMetadata.sampleRate,
          channels: streamMetadata.channels,
          packetCount: result.timeline?.sampleCount,
          firstPtsTime: result.timeline?.firstPtsTime,
          lastPtsTime: result.timeline?.lastPtsTime,
          lastSampleDurationSeconds: result.timeline?.lastSampleDurationTime,
          firstPtsUs: secondsToMicroseconds(result.timeline?.firstPtsTime),
          lastPtsUs: secondsToMicroseconds(result.timeline?.lastPtsTime),
          lastSampleDurationUs: secondsToMicroseconds(result.timeline?.lastSampleDurationTime),
          keyframeCount: result.timeline?.keyframeCount,
          startsWithKeyframe: result.timeline?.startsWithKeyframe,
          maxKeyframeGapSeconds: result.timeline?.maxKeyframeGapSeconds,
          ok: result.ok,
          errors: result.errors,
        });
      }
      applyBoundaryAnalysis(candidate, candidateEntries);
      applyAudioTimestampContinuityAnalysis(candidate, candidateEntries);
      entries.push(...candidateEntries);
    }

    const okSegments = entries.filter((entry) => entry.ok).length;
    const media = buildMediaAnalysisSummaries(entries);
    const avAlignment = buildAvAlignmentSummary(entries);
    const issues = buildAnalysisIssues(entries, media, avAlignment);
    return {
      originId: clone.id,
      ok: entries.every((entry) => entry.ok) && !issues.some((issue) => issue.severity === "error"),
      sampledMediaPlaylists: candidates.length,
      totalMediaPlaylists: clone.variantCount + clone.renditionCount,
      sampledSegments: entries.length,
      okSegments,
      failedSegments: entries.length - okSegments,
      media,
      avAlignment,
      issues,
      entries,
    };
  }

  async removeOrigin(originId: string): Promise<StreamerRemoveResult> {
    const id = sanitizeOriginId(originId);
    const originDir = path.join(this.rootDir, id);
    await fs.rm(originDir, { recursive: true, force: false });
    return {
      id,
      rootDir: originDir,
      removed: true,
    };
  }

  async cloneHls(input: StreamerCloneInput): Promise<StreamerCloneResult> {
    const durationSeconds = normalizePositiveNumber(
      input.durationSeconds,
      DEFAULT_DURATION_SECONDS,
      1,
      60 * 60,
    );
    const startSeconds = normalizeNonNegativeNumber(input.startSeconds, 0, 0, 24 * 60 * 60);
    const timeoutMs = normalizePositiveNumber(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
    const segmentTimeoutMs = normalizePositiveNumber(
      input.segmentTimeoutMs,
      DEFAULT_SEGMENT_TIMEOUT_MS,
      1_000,
      5 * 60_000,
    );
    const segmentRetries = normalizeNonNegativeInteger(input.segmentRetries, DEFAULT_SEGMENT_RETRIES, 0, 5);
    const maxSegments = Math.floor(
      normalizePositiveNumber(input.maxSegments, DEFAULT_MAX_SEGMENTS, 1, DEFAULT_MAX_SEGMENTS),
    );
    const id = sanitizeOriginId(input.originId?.trim() || randomUUID());
    const originDir = path.join(this.rootDir, id);
    const emit = input.onProgress ?? (() => undefined);

    await fs.mkdir(originDir, { recursive: true });
    emit({
      type: "start",
      originId: id,
      url: input.url,
      durationSeconds,
      startSeconds,
      allVariants: Boolean(input.allVariants),
    });
    emit({ type: "manifest_fetch", url: input.url });

    const root = await this.inspect.inspectHls({
      url: input.url,
      maxSegments,
      timeoutMs,
    });
    emit({
      type: "manifest_ready",
      url: root.finalUrl,
      playlistType: root.playlistType,
      variantCount: root.variants.length,
      segmentCount: root.segments.length,
    });

    let selectedUrl = root.url;
    let finalUrl = root.finalUrl;
    let selectedVariant: StreamerCloneResult["selectedVariant"];
    let allVariants = false;
    let clonedVariants: StreamerClonedVariant[] = [];
    let clonedRenditions: StreamerClonedRendition[] = [];

    if (input.allVariants && root.playlistType === "master") {
      const variantsToClone = selectAllVariants(root, input.maxVariants);
      for (let index = 0; index < variantsToClone.length; index += 1) {
        const variant = variantsToClone[index];
        emit({
          type: "variant_inspect",
          variantIndex: index,
          variantCount: variantsToClone.length,
          label: formatVariantLabel(variant),
          url: variant.url,
        });
        const inspected = await this.inspect.inspectHls({
          url: variant.url,
          maxSegments,
          timeoutMs,
        });
        const localDir = `variants/${buildVariantDirName(index, variant)}`;
        clonedVariants.push(
          await this.cloneMediaPlaylist({
            inspected,
            originDir,
            localDir,
            durationSeconds,
            startSeconds,
            timeoutMs,
            segmentTimeoutMs,
            segmentRetries,
            playlistSource: {
              uri: variant.uri,
              url: variant.url,
            },
            variant,
            variantIndex: index,
            variantCount: variantsToClone.length,
            progress: emit,
          }),
        );
      }

      allVariants = true;
      finalUrl = root.finalUrl;
      selectedUrl = root.url;
      clonedRenditions = await this.cloneLinkedRenditions({
        root,
        variants: variantsToClone,
        originDir,
        durationSeconds,
        startSeconds,
        timeoutMs,
        maxSegments,
        segmentTimeoutMs,
        segmentRetries,
        progress: emit,
      });
      const manifestText = buildLocalMasterPlaylist(clonedVariants, clonedRenditions);
      await fs.writeFile(path.join(originDir, "index.m3u8"), manifestText, "utf-8");
    } else {
      if (root.playlistType === "master") {
        const selectedForProgress = selectVariant(root, input.variant);
        emit({
          type: "variant_inspect",
          variantIndex: 0,
          variantCount: 1,
          label: formatVariantLabel(toVariantSource(selectedForProgress)),
          url: selectedForProgress.url,
        });
      }
      const selected = await this.resolveMediaPlaylist(root, input.variant, maxSegments, timeoutMs);
      selectedUrl = selected.inspected.url;
      finalUrl = selected.inspected.finalUrl;
      selectedVariant = selected.selectedVariant;
      const linkedRenditions =
        root.playlistType === "master" && selected.selectedVariant
          ? selectLinkedRenditions(root, [selected.selectedVariant])
          : [];
      const useLocalMaster = linkedRenditions.length > 0;
      clonedVariants = [
        await this.cloneMediaPlaylist({
          inspected: selected.inspected,
          originDir,
          localDir: useLocalMaster && selected.selectedVariant
            ? `variants/${buildVariantDirName(0, selected.selectedVariant)}`
            : ".",
          durationSeconds,
          startSeconds,
          timeoutMs,
          segmentTimeoutMs,
          segmentRetries,
          playlistSource: selected.selectedVariant
            ? {
                uri: selected.selectedVariant.uri,
                url: selected.selectedVariant.url,
              }
            : undefined,
          variant: selected.selectedVariant,
          variantIndex: 0,
          variantCount: 1,
          progress: emit,
        }),
      ];
      if (useLocalMaster && selected.selectedVariant) {
        clonedRenditions = await this.cloneLinkedRenditions({
          root,
          variants: [selected.selectedVariant],
          originDir,
          durationSeconds,
          startSeconds,
          timeoutMs,
          maxSegments,
          segmentTimeoutMs,
          segmentRetries,
          progress: emit,
          renditions: linkedRenditions,
        });
        const manifestText = buildLocalMasterPlaylist(clonedVariants, clonedRenditions);
        await fs.writeFile(path.join(originDir, "index.m3u8"), manifestText, "utf-8");
      }
    }

    const clonedSegments = clonedVariants.flatMap((variant) => variant.segments);
    const cumulativeDurationSeconds = minVariantDuration(clonedVariants);
    const targetDuration = Math.max(...clonedVariants.map((variant) => variant.targetDuration), 1);
    const manifestPath = path.join(originDir, "index.m3u8");
    const totalBytes =
      clonedVariants.reduce((acc, variant) => acc + variant.bytes, 0) +
      clonedRenditions.reduce((acc, rendition) => acc + rendition.bytes, 0);

    const metadataPath = path.join(originDir, "origin.json");
    const createdAt = new Date().toISOString();
    const result: StreamerCloneResult = {
      id,
      schemaVersion: STREAMER_ORIGIN_SCHEMA_VERSION,
      sessionKey: input.sessionKey,
      sourceUrl: root.url,
      selectedUrl,
      finalUrl,
      rootDir: originDir,
      manifestPath,
      playbackPath: "/index.m3u8",
      requestedDurationSeconds: durationSeconds,
      requestedStartSeconds: startSeconds > 0 ? startSeconds : undefined,
      cumulativeDurationSeconds,
      reachedTargetDuration: clonedVariants.every((variant) => variant.reachedTargetDuration),
      targetDuration,
      segmentCount: clonedVariants.reduce((acc, variant) => acc + variant.segmentCount, 0),
      variantCount: clonedVariants.length,
      renditionCount: clonedRenditions.length,
      bytes: totalBytes,
      allVariants,
      selectedVariant,
      createdAt,
      variants: clonedVariants,
      renditions: clonedRenditions,
      segments: clonedSegments,
    };

    await fs.writeFile(metadataPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
    emit({
      type: "complete",
      originId: id,
      segmentCount: result.segmentCount,
      variantCount: result.variantCount,
      bytes: result.bytes,
      cumulativeDurationSeconds: result.cumulativeDurationSeconds,
    });
    return result;
  }

  async serveOrigin(originId: string, options: StreamerServeOptions = {}): Promise<StreamerServeHandle> {
    const id = sanitizeOriginId(originId);
    const originDir = path.join(this.rootDir, id);
    await fs.access(path.join(originDir, "index.m3u8"));

    const host = options.host?.trim() || "127.0.0.1";
    const port = Math.max(0, Math.min(65_535, Math.floor(options.port ?? 0)));

    const server = http.createServer((request, response) => {
      void this.handleStaticRequest(originDir, request, response);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://${host}:${address.port}`;

    return {
      originId: id,
      rootDir: originDir,
      baseUrl,
      playbackUrl: `${baseUrl}/index.m3u8`,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    };
  }

  async serveLiveOrigin(
    originId: string,
    options: StreamerLiveServeOptions = {},
  ): Promise<StreamerLiveServeHandle> {
    const id = sanitizeOriginId(originId);
    const clone = await this.loadCloneResult(id);
    const host = options.host?.trim() || "127.0.0.1";
    const port = Math.max(0, Math.min(65_535, Math.floor(options.port ?? 0)));
    const windowSize = Math.max(1, Math.min(30, Math.floor(options.windowSize ?? DEFAULT_LIVE_WINDOW_SIZE)));
    const initialMediaSequence = Math.max(
      0,
      Math.floor(options.initialMediaSequence ?? DEFAULT_INITIAL_MEDIA_SEQUENCE),
    );
    const startedAtMs = Date.now();

    const server = http.createServer((request, response) => {
      void this.handleLiveRequest(
        clone,
        {
          startedAtMs,
          windowSize,
          initialMediaSequence,
        },
        request,
        response,
      );
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://${host}:${address.port}`;

    return {
      originId: id,
      rootDir: clone.rootDir,
      baseUrl,
      playbackUrl: `${baseUrl}/index.m3u8`,
      windowSize,
      initialMediaSequence,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    };
  }

  private async resolveMediaPlaylist(
    root: VideoHlsInspectResult,
    variantSelector: string | undefined,
    maxSegments: number,
    timeoutMs: number,
  ): Promise<SelectedMediaPlaylist> {
    if (root.playlistType === "media") {
      return { inspected: root };
    }

    if (root.playlistType !== "master") {
      throw new Error(`streamer clone supports HLS master/media playlists; got ${root.playlistType}`);
    }

    const variant = selectVariant(root, variantSelector);
    const inspected = await this.inspect.inspectHls({
      url: variant.url,
      maxSegments,
      timeoutMs,
    });

    return {
      inspected,
      selectedVariant: {
        uri: variant.uri,
        url: variant.url,
        bandwidth: variant.bandwidth,
        averageBandwidth: variant.averageBandwidth,
        resolution: variant.resolution,
        frameRate: variant.frameRate,
        codecs: variant.codecs,
        audioGroupId: variant.audioGroupId,
        subtitlesGroupId: variant.subtitlesGroupId,
        closedCaptions: variant.closedCaptions,
      },
    };
  }

  private async cloneMediaPlaylist(params: {
    inspected: VideoHlsInspectResult;
    originDir: string;
    localDir: string;
    durationSeconds: number;
    startSeconds: number;
    timeoutMs: number;
    segmentTimeoutMs: number;
    segmentRetries: number;
    playlistSource?: {
      uri: string;
      url: string;
    };
    label?: string;
    variant?: VariantSource;
    variantIndex: number;
    variantCount: number;
    progress: ProgressEmitter;
  }): Promise<StreamerClonedVariant> {
    if (params.inspected.playlistType !== "media") {
      throw new Error(`streamer clone supports HLS media playlists; got ${params.inspected.playlistType}`);
    }

    const variantDir = params.localDir === "." ? params.originDir : path.join(params.originDir, params.localDir);
    const segmentsDir = path.join(variantDir, "segments");
    await fs.mkdir(segmentsDir, { recursive: true });

    const selectedSegments = selectSegmentsForWindow(params.inspected, params.startSeconds, params.durationSeconds);
    if (selectedSegments.length === 0) {
      throw new Error("streamer clone found no downloadable media segments");
    }

    const variantLabel = params.variant ? formatVariantLabel(params.variant) : params.label ?? "media playlist direta";
    params.progress({
      type: "variant_ready",
      variantIndex: params.variantIndex,
      variantCount: params.variantCount,
      label: variantLabel,
      segmentCount: selectedSegments.length,
      targetDuration: params.inspected.targetDuration ?? 0,
    });

    const clonedSegments: StreamerClonedSegment[] = [];
    const clonedMapsBySource = new Map<string, StreamerClonedMap>();
    let totalBytes = 0;
    let cumulativeDurationSeconds = 0;

    const ensureClonedMap = async (
      map: NonNullable<VideoHlsInspectResult["segments"][number]["map"]>,
    ): Promise<StreamerClonedMap> => {
      if (map.byteRange) {
        throw new Error("streamer clone does not support EXT-X-MAP with BYTERANGE yet");
      }
      const existing = clonedMapsBySource.get(map.url);
      if (existing) {
        return existing;
      }

      const localUri = `init/${buildSegmentFileName(clonedMapsBySource.size, map.uri)}`;
      await fs.mkdir(path.dirname(path.join(variantDir, localUri)), { recursive: true });
      const bytes = await this.fetchBytesWithRetries({
        url: map.url,
        timeoutMs: params.segmentTimeoutMs,
        retries: params.segmentRetries,
        progress: () => undefined,
        variantIndex: params.variantIndex,
        variantCount: params.variantCount,
        segmentIndex: 0,
        segmentCount: 0,
      });
      await fs.writeFile(path.join(variantDir, localUri), bytes);
      totalBytes += bytes.byteLength;
      const clonedMap: StreamerClonedMap = {
        sourceUri: map.uri,
        sourceUrl: map.url,
        localUri,
        bytes: bytes.byteLength,
      };
      clonedMapsBySource.set(map.url, clonedMap);
      return clonedMap;
    };

    for (let index = 0; index < selectedSegments.length; index += 1) {
      const selectedSegment = selectedSegments[index];
      const localUri = `segments/${buildSegmentFileName(index, selectedSegment.segment.uri)}`;
      const localPath = path.join(variantDir, localUri);
      params.progress({
        type: "segment_download_start",
        variantIndex: params.variantIndex,
        variantCount: params.variantCount,
        segmentIndex: index,
        segmentCount: selectedSegments.length,
        url: selectedSegment.segment.url,
        duration: selectedSegment.segment.duration,
      });
      const bytes = await this.fetchBytesWithRetries({
        url: selectedSegment.segment.url,
        timeoutMs: params.segmentTimeoutMs,
        retries: params.segmentRetries,
        progress: params.progress,
        variantIndex: params.variantIndex,
        variantCount: params.variantCount,
        segmentIndex: index,
        segmentCount: selectedSegments.length,
      });
      const clonedMap = selectedSegment.segment.map
        ? await ensureClonedMap(selectedSegment.segment.map)
        : undefined;
      await fs.writeFile(localPath, bytes);
      totalBytes += bytes.byteLength;
      cumulativeDurationSeconds += selectedSegment.segment.duration ?? params.inspected.targetDuration ?? 0;
      clonedSegments.push({
        originalIndex: selectedSegment.index,
        sourceUri: selectedSegment.segment.uri,
        sourceUrl: selectedSegment.segment.url,
        localUri,
        duration: selectedSegment.segment.duration,
        timelineStartSeconds: selectedSegment.timelineStartSeconds,
        timelineEndSeconds: selectedSegment.timelineEndSeconds,
        title: selectedSegment.segment.title,
        bytes: bytes.byteLength,
        map: clonedMap,
      });
      params.progress({
        type: "segment_downloaded",
        variantIndex: params.variantIndex,
        variantCount: params.variantCount,
        segmentIndex: index,
        segmentCount: selectedSegments.length,
        localUri,
        bytes: bytes.byteLength,
        cumulativeBytes: totalBytes,
        cumulativeDurationSeconds,
      });
    }

    const targetDuration = deriveTargetDuration(params.inspected, clonedSegments);
    const manifestText = buildLocalMediaPlaylist({
      source: params.inspected,
      segments: clonedSegments,
      targetDuration,
    });
    const manifestPath = path.join(variantDir, "index.m3u8");
    await fs.writeFile(manifestPath, manifestText, "utf-8");

    return {
      sourceUri: params.playlistSource?.uri ?? params.variant?.uri ?? params.inspected.url,
      sourceUrl: params.playlistSource?.url ?? params.variant?.url ?? params.inspected.url,
      finalUrl: params.inspected.finalUrl,
      localUri: params.localDir === "." ? "index.m3u8" : `${params.localDir}/index.m3u8`,
      manifestPath,
      targetDuration,
      segmentCount: clonedSegments.length,
      cumulativeDurationSeconds,
      reachedTargetDuration: cumulativeDurationSeconds >= params.durationSeconds,
      bytes: totalBytes,
      maps: [...clonedMapsBySource.values()],
      variant: params.variant,
      segments: clonedSegments,
    };
  }

  private async cloneLinkedRenditions(params: {
    root: VideoHlsInspectResult;
    variants: VariantSource[];
    originDir: string;
    durationSeconds: number;
    startSeconds: number;
    timeoutMs: number;
    maxSegments: number;
    segmentTimeoutMs: number;
    segmentRetries: number;
    progress: ProgressEmitter;
    renditions?: RenditionSource[];
  }): Promise<StreamerClonedRendition[]> {
    const renditions = params.renditions ?? selectLinkedRenditions(params.root, params.variants);
    const cloned: StreamerClonedRendition[] = [];
    const nextIndexByKind: Record<RenditionKind, number> = {
      AUDIO: 0,
      SUBTITLES: 0,
    };

    for (let index = 0; index < renditions.length; index += 1) {
      const rendition = renditions[index];
      if (!rendition.uri || !rendition.url) {
        continue;
      }
      const kind = requireRenditionKind(rendition.type);
      const kindIndex = nextIndexByKind[kind];
      nextIndexByKind[kind] += 1;

      const label = formatRenditionLabel(rendition);
      params.progress({
        type: "variant_inspect",
        variantIndex: index,
        variantCount: renditions.length,
        label,
        url: rendition.url,
      });
      const inspected = await this.inspect.inspectHls({
        url: rendition.url,
        maxSegments: params.maxSegments,
        timeoutMs: params.timeoutMs,
      });
      const localDir = `${renditionDirectory(rendition)}/${buildRenditionDirName(kindIndex, rendition)}`;
      const media = await this.cloneMediaPlaylist({
        inspected,
        originDir: params.originDir,
        localDir,
        durationSeconds: params.durationSeconds,
        startSeconds: params.startSeconds,
        timeoutMs: params.timeoutMs,
        segmentTimeoutMs: params.segmentTimeoutMs,
        segmentRetries: params.segmentRetries,
        playlistSource: {
          uri: rendition.uri,
          url: rendition.url,
        },
        label,
        variantIndex: index,
        variantCount: renditions.length,
        progress: params.progress,
      });

      cloned.push({
        type: rendition.type,
        groupId: rendition.groupId,
        name: rendition.name,
        language: rendition.language,
        default: rendition.default,
        autoselect: rendition.autoselect,
        forced: rendition.forced,
        channels: rendition.channels,
        characteristics: rendition.characteristics,
        sourceUri: media.sourceUri,
        sourceUrl: media.sourceUrl,
        finalUrl: media.finalUrl,
        localUri: media.localUri,
        manifestPath: media.manifestPath,
        targetDuration: media.targetDuration,
        segmentCount: media.segmentCount,
        cumulativeDurationSeconds: media.cumulativeDurationSeconds,
        reachedTargetDuration: media.reachedTargetDuration,
        bytes: media.bytes,
        maps: media.maps,
        segments: media.segments,
      });
    }

    return cloned;
  }

  private async fetchBytes(url: string, timeoutMs: number): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "user-agent": "Kael/0.1 (+streamer)" },
      });
      if (!response.ok) {
        throw new Error(`failed to download segment ${url}: HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`segment download timed out after ${timeoutMs}ms: ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchBytesWithRetries(params: {
    url: string;
    timeoutMs: number;
    retries: number;
    progress: ProgressEmitter;
    variantIndex: number;
    variantCount: number;
    segmentIndex: number;
    segmentCount: number;
  }): Promise<Uint8Array> {
    const maxAttempts = params.retries + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.fetchBytes(params.url, params.timeoutMs);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) {
          break;
        }
        params.progress({
          type: "segment_download_retry",
          variantIndex: params.variantIndex,
          variantCount: params.variantCount,
          segmentIndex: params.segmentIndex,
          segmentCount: params.segmentCount,
          attempt: attempt + 1,
          maxAttempts,
          error: errorMessage(error),
        });
      }
    }

    throw new Error(
      `failed to download segment after ${maxAttempts} attempt(s): ${errorMessage(lastError)}`,
    );
  }

  private async handleStaticRequest(
    rootDir: string,
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET, HEAD, OPTIONS");
    response.setHeader("access-control-allow-headers", "range, origin, accept, content-type");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.statusCode = 405;
      response.end("method not allowed");
      return;
    }

    try {
      const requestUrl = new URL(request.url || "/", "http://streamer.local");
      const pathname = requestUrl.pathname === "/" ? "/index.m3u8" : requestUrl.pathname;
      const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
      const filePath = path.resolve(rootDir, relativePath);
      const safeRoot = path.resolve(rootDir);

      if (filePath !== safeRoot && !filePath.startsWith(`${safeRoot}${path.sep}`)) {
        response.statusCode = 403;
        response.end("forbidden");
        return;
      }

      const data = await fs.readFile(filePath);
      response.statusCode = 200;
      response.setHeader("content-type", contentTypeFor(filePath));
      response.setHeader("cache-control", "no-store");
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      response.end(data);
    } catch {
      response.statusCode = 404;
      response.end("not found");
    }
  }

  private async handleLiveRequest(
    clone: StreamerCloneResult,
    state: {
      startedAtMs: number;
      windowSize: number;
      initialMediaSequence: number;
    },
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET, HEAD, OPTIONS");
    response.setHeader("access-control-allow-headers", "range, origin, accept, content-type");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.statusCode = 405;
      response.end("method not allowed");
      return;
    }

    try {
      const requestUrl = new URL(request.url || "/", "http://streamer.live");
      const pathname = requestUrl.pathname === "/" ? "/index.m3u8" : requestUrl.pathname;

      if (pathname === "/index.m3u8") {
        const body =
          clone.variants.length > 1 || clone.renditions.length > 0
            ? buildLiveMasterPlaylist(clone.variants, clone.renditions)
            : buildLiveMediaPlaylist(clone.variants[0], "/live/0", state, Date.now());
        sendText(response, request.method, body, "application/vnd.apple.mpegurl");
        return;
      }

      const mediaMatch = pathname.match(/^\/live\/(\d+)\/index\.m3u8$/);
      if (mediaMatch) {
        const variantIndex = parseVariantIndex(clone, mediaMatch[1]);
        const variant = clone.variants[variantIndex];
        const body = buildLiveMediaPlaylist(variant, `/live/${variantIndex}`, state, Date.now());
        sendText(response, request.method, body, "application/vnd.apple.mpegurl");
        return;
      }

      const renditionMediaMatch = pathname.match(/^\/live\/(audio|subtitles)\/(\d+)\/index\.m3u8$/);
      if (renditionMediaMatch) {
        const renditionKind = renditionKindFromRoute(renditionMediaMatch[1]);
        const renditionIndex = parseRenditionIndex(renditionMediaMatch[2]);
        const ref = findRenditionRef(clone.renditions, renditionKind, renditionIndex);
        const body = buildLiveMediaPlaylist(ref.rendition, liveRenditionPath(ref), state, Date.now());
        sendText(response, request.method, body, "application/vnd.apple.mpegurl");
        return;
      }

      const segmentMatch = pathname.match(/^\/live\/(\d+)\/segments\/(\d+)(?:\.[^/]*)?$/);
      if (segmentMatch) {
        const variantIndex = parseVariantIndex(clone, segmentMatch[1]);
        const variant = clone.variants[variantIndex];
        const sequence = Number(segmentMatch[2]);
        if (!Number.isSafeInteger(sequence) || sequence < 0) {
          throw new Error("invalid live segment sequence");
        }
        const segment = segmentForSequence(variant, sequence);
        const filePath = resolveClonedSegmentPath(clone.rootDir, variant, segment);
        const data = await fs.readFile(filePath);
        response.statusCode = 200;
        response.setHeader("content-type", contentTypeFor(filePath));
        response.setHeader("cache-control", "no-store");
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        response.end(data);
        return;
      }

      const renditionSegmentMatch = pathname.match(/^\/live\/(audio|subtitles)\/(\d+)\/segments\/(\d+)(?:\.[^/]*)?$/);
      if (renditionSegmentMatch) {
        const renditionKind = renditionKindFromRoute(renditionSegmentMatch[1]);
        const renditionIndex = parseRenditionIndex(renditionSegmentMatch[2]);
        const ref = findRenditionRef(clone.renditions, renditionKind, renditionIndex);
        const rendition = ref.rendition;
        const sequence = Number(renditionSegmentMatch[3]);
        if (!Number.isSafeInteger(sequence) || sequence < 0) {
          throw new Error("invalid live rendition segment sequence");
        }
        const segment = segmentForSequence(rendition, sequence);
        const filePath = resolveClonedSegmentPath(clone.rootDir, rendition, segment);
        const data = await fs.readFile(filePath);
        response.statusCode = 200;
        response.setHeader("content-type", contentTypeFor(filePath));
        response.setHeader("cache-control", "no-store");
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        response.end(data);
        return;
      }

      const mapMatch = pathname.match(/^\/live\/(\d+)\/init\/([^/]+)$/);
      if (mapMatch) {
        const variantIndex = parseVariantIndex(clone, mapMatch[1]);
        const variant = clone.variants[variantIndex];
        const localUri = `init/${decodeURIComponent(mapMatch[2] ?? "")}`;
        const clonedMap = (variant.maps ?? []).find((candidate) => candidate.localUri === localUri);
        if (!clonedMap) {
          throw new Error("live init segment not found");
        }
        const filePath = resolveClonedMapPath(clone.rootDir, variant, clonedMap);
        const data = await fs.readFile(filePath);
        response.statusCode = 200;
        response.setHeader("content-type", contentTypeFor(filePath));
        response.setHeader("cache-control", "no-store");
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        response.end(data);
        return;
      }

      const renditionMapMatch = pathname.match(/^\/live\/(audio|subtitles)\/(\d+)\/init\/([^/]+)$/);
      if (renditionMapMatch) {
        const renditionKind = renditionKindFromRoute(renditionMapMatch[1]);
        const renditionIndex = parseRenditionIndex(renditionMapMatch[2]);
        const ref = findRenditionRef(clone.renditions, renditionKind, renditionIndex);
        const rendition = ref.rendition;
        const localUri = `init/${decodeURIComponent(renditionMapMatch[3] ?? "")}`;
        const clonedMap = (rendition.maps ?? []).find((candidate) => candidate.localUri === localUri);
        if (!clonedMap) {
          throw new Error("live rendition init segment not found");
        }
        const filePath = resolveClonedMapPath(clone.rootDir, rendition, clonedMap);
        const data = await fs.readFile(filePath);
        response.statusCode = 200;
        response.setHeader("content-type", contentTypeFor(filePath));
        response.setHeader("cache-control", "no-store");
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        response.end(data);
        return;
      }

      response.statusCode = 404;
      response.end("not found");
    } catch {
      response.statusCode = 404;
      response.end("not found");
    }
  }

  private async loadCloneResult(originId: string): Promise<StreamerCloneResult> {
    const id = sanitizeOriginId(originId);
    const originDir = path.join(this.rootDir, id);
    const raw = await fs.readFile(path.join(originDir, "origin.json"), "utf-8");
    const parsed = JSON.parse(raw) as Partial<StreamerCloneResult>;
    if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
      throw new Error(`streamer origin ${id} has no cloned variants`);
    }
    if (!Array.isArray(parsed.renditions)) {
      throw new Error(`streamer origin ${id} is not compatible with current schema`);
    }
    const clone = parsed as StreamerCloneResult;
    return {
      ...clone,
      id,
      schemaVersion: STREAMER_ORIGIN_SCHEMA_VERSION,
      rootDir: originDir,
    };
  }
}

function normalizePositiveNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeNonNegativeNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }
  return Math.floor(Math.max(min, Math.min(max, value)));
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || error.message.toLowerCase().includes("aborted");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function sanitizeOriginId(raw: string): string {
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  if (!sanitized) {
    throw new Error("origin id must contain at least one safe character");
  }
  return sanitized.slice(0, 96);
}

function selectVariant(root: VideoHlsInspectResult, selector: string | undefined): VideoHlsInspectResult["variants"][number] {
  if (root.variants.length === 0) {
    throw new Error("master playlist has no variants to clone");
  }

  const normalized = selector?.trim().toLowerCase() || "aac-highest";
  if (normalized === "aac-highest" || normalized === "browser" || normalized === "browser-compatible") {
    const safeVariants = root.variants.filter(isBrowserSafeHlsVariant);
    return selectHighestBandwidth(safeVariants.length > 0 ? safeVariants : root.variants);
  }

  if (normalized === "aac-lowest") {
    const safeVariants = root.variants.filter(isBrowserSafeHlsVariant);
    return selectLowestBandwidth(safeVariants.length > 0 ? safeVariants : root.variants);
  }

  if (normalized === "lowest") {
    return selectLowestBandwidth(root.variants);
  }

  if (normalized === "highest") {
    return selectHighestBandwidth(root.variants);
  }

  const index = Number(normalized);
  if (Number.isInteger(index) && index >= 0 && index < root.variants.length) {
    return root.variants[index];
  }

  throw new Error(
    `unknown variant selector "${selector}". Use aac-highest, highest, lowest, or a zero-based index.`,
  );
}

function selectHighestBandwidth<T extends { bandwidth?: number }>(variants: T[]): T {
  return [...variants].sort((left, right) => (right.bandwidth ?? 0) - (left.bandwidth ?? 0))[0];
}

function selectLowestBandwidth<T extends { bandwidth?: number }>(variants: T[]): T {
  return [...variants].sort((left, right) => (left.bandwidth ?? Infinity) - (right.bandwidth ?? Infinity))[0];
}

function selectAllVariants(root: VideoHlsInspectResult, maxVariants: number | undefined): VariantSource[] {
  if (root.variants.length === 0) {
    throw new Error("master playlist has no variants to clone");
  }

  const normalizedMax =
    typeof maxVariants === "number" && Number.isFinite(maxVariants) && maxVariants > 0
      ? Math.floor(maxVariants)
      : root.variants.length;

  return root.variants.slice(0, normalizedMax).map(toVariantSource);
}

function selectLinkedRenditions(root: VideoHlsInspectResult, variants: VariantSource[]): RenditionSource[] {
  return [
    ...selectRenditionsByGroups(
      root,
      "AUDIO",
      variants
        .map((variant) => variant.audioGroupId)
        .filter((value): value is string => Boolean(value)),
    ),
    ...selectRenditionsByGroups(
      root,
      "SUBTITLES",
      variants
        .map((variant) => variant.subtitlesGroupId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function selectRenditionsByGroups(
  root: VideoHlsInspectResult,
  type: RenditionKind,
  groupIds: string[],
): RenditionSource[] {
  const selectedGroupIds = new Set(groupIds);
  if (selectedGroupIds.size === 0) {
    return [];
  }

  const seen = new Set<string>();
  const out: RenditionSource[] = [];
  for (const rendition of root.renditions) {
    if (rendition.type.toUpperCase() !== type || !rendition.groupId || !rendition.uri || !rendition.url) {
      continue;
    }
    if (!selectedGroupIds.has(rendition.groupId)) {
      continue;
    }
    const key = `${rendition.type}|${rendition.groupId}|${rendition.name ?? ""}|${rendition.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(rendition);
  }
  return out;
}

function renditionGroupIdsFor(renditions: StreamerClonedRendition[], kind: RenditionKind): Set<string> {
  return new Set(
    renditions
      .filter((rendition) => normalizeRenditionKind(rendition.type) === kind && rendition.groupId)
      .map((rendition) => rendition.groupId as string),
  );
}

function normalizeRenditionKind(type: string): RenditionKind | null {
  const normalized = type.trim().toUpperCase();
  if (normalized === "AUDIO" || normalized === "SUBTITLES") {
    return normalized;
  }
  return null;
}

function requireRenditionKind(type: string): RenditionKind {
  const kind = normalizeRenditionKind(type);
  if (!kind) {
    throw new Error(`unsupported rendition type "${type}"`);
  }
  return kind;
}

function renditionDirectory(rendition: RenditionSource | StreamerClonedRendition): "audio" | "subtitles" {
  return RENDITION_KIND_CONFIG[requireRenditionKind(rendition.type)].dir;
}

function liveRenditionPath(ref: RenditionRef): string {
  return `/live/${RENDITION_KIND_CONFIG[ref.kind].route}/${ref.routeIndex}`;
}

function renditionKindFromRoute(raw: string | undefined): RenditionKind {
  return raw === "subtitles" ? "SUBTITLES" : "AUDIO";
}

function buildRenditionRefs(renditions: StreamerClonedRendition[]): RenditionRef[] {
  const nextIndexByKind: Record<RenditionKind, number> = {
    AUDIO: 0,
    SUBTITLES: 0,
  };
  const refs: RenditionRef[] = [];

  for (let globalIndex = 0; globalIndex < renditions.length; globalIndex += 1) {
    const rendition = renditions[globalIndex];
    const kind = requireRenditionKind(rendition.type);
    refs.push({
      kind,
      routeIndex: nextIndexByKind[kind],
      globalIndex,
      rendition,
    });
    nextIndexByKind[kind] += 1;
  }

  return refs;
}

function findRenditionRef(
  renditions: StreamerClonedRendition[],
  kind: RenditionKind,
  routeIndex: number,
): RenditionRef {
  const ref = buildRenditionRefs(renditions).find((candidate) => candidate.kind === kind && candidate.routeIndex === routeIndex);
  if (!ref) {
    throw new Error("invalid live rendition index");
  }
  return ref;
}

function toVariantSource(variant: VideoHlsInspectResult["variants"][number]): VariantSource {
  return {
    uri: variant.uri,
    url: variant.url,
    bandwidth: variant.bandwidth,
    averageBandwidth: variant.averageBandwidth,
    resolution: variant.resolution,
    frameRate: variant.frameRate,
    codecs: variant.codecs,
    audioGroupId: variant.audioGroupId,
    subtitlesGroupId: variant.subtitlesGroupId,
    closedCaptions: variant.closedCaptions,
  };
}

function formatVariantLabel(variant: VariantSource): string {
  const parts = [
    variant.resolution,
    typeof variant.bandwidth === "number" ? `${variant.bandwidth}bps` : undefined,
    variant.codecs,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" | ") : variant.uri;
}

function formatRenditionLabel(rendition: RenditionSource): string {
  const parts = [
    rendition.type,
    rendition.groupId,
    rendition.name,
    rendition.channels ? `${rendition.channels}ch` : undefined,
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" | ") : rendition.uri ?? "rendition";
}

function selectSegmentsForWindow(
  inspected: VideoHlsInspectResult,
  startSeconds: number,
  durationSeconds: number,
): Array<{
  index: number;
  segment: VideoHlsInspectResult["segments"][number];
  timelineStartSeconds: number;
  timelineEndSeconds: number;
}> {
  const out: Array<{
    index: number;
    segment: VideoHlsInspectResult["segments"][number];
    timelineStartSeconds: number;
    timelineEndSeconds: number;
  }> = [];
  let cumulativeDuration = 0;
  const windowEndSeconds = startSeconds + durationSeconds;

  for (let index = 0; index < inspected.segments.length; index += 1) {
    const segment = inspected.segments[index];
    const segmentDuration = segment.duration ?? inspected.targetDuration ?? 0;
    const timelineStartSeconds = cumulativeDuration;
    const timelineEndSeconds = cumulativeDuration + segmentDuration;
    cumulativeDuration = timelineEndSeconds;

    if (timelineEndSeconds <= startSeconds) {
      continue;
    }
    if (timelineStartSeconds >= windowEndSeconds && out.length > 0) {
      break;
    }

    out.push({ index, segment, timelineStartSeconds, timelineEndSeconds });
    if (timelineEndSeconds >= windowEndSeconds) {
      break;
    }
  }

  return out;
}

function minVariantDuration(variants: StreamerClonedVariant[]): number {
  if (variants.length === 0) {
    return 0;
  }
  return Math.min(...variants.map((variant) => variant.cumulativeDurationSeconds));
}

function toOriginSummary(result: StreamerCloneResult): StreamerOriginSummary {
  return {
    id: result.id,
    schemaVersion: result.schemaVersion,
    derivedFrom: result.derivedFrom,
    faults: result.faults ?? [],
    createdAt: result.createdAt,
    sourceUrl: result.sourceUrl,
    selectedUrl: result.selectedUrl,
    rootDir: result.rootDir,
    playbackPath: result.playbackPath,
    requestedDurationSeconds: result.requestedDurationSeconds,
    requestedStartSeconds: result.requestedStartSeconds,
    cumulativeDurationSeconds: result.cumulativeDurationSeconds,
    reachedTargetDuration: result.reachedTargetDuration,
    targetDuration: result.targetDuration,
    segmentCount: result.segmentCount,
    variantCount: result.variantCount,
    renditionCount: result.renditionCount,
    bytes: result.bytes,
    allVariants: result.allVariants,
  };
}

function rebaseCloneResult(source: StreamerCloneResult, id: string, rootDir: string): StreamerCloneResult {
  const rebaseManifestPath = (manifestPath: string): string => path.join(rootDir, path.relative(source.rootDir, manifestPath));
  return {
    ...source,
    id,
    rootDir,
    manifestPath: rebaseManifestPath(source.manifestPath),
    variants: source.variants.map((variant) => ({
      ...variant,
      manifestPath: rebaseManifestPath(variant.manifestPath),
      segments: variant.segments.map((segment) => ({ ...segment })),
      maps: variant.maps.map((map) => ({ ...map })),
    })),
    renditions: source.renditions.map((rendition) => ({
      ...rendition,
      manifestPath: rebaseManifestPath(rendition.manifestPath),
      segments: rendition.segments.map((segment) => ({ ...segment })),
      maps: rendition.maps.map((map) => ({ ...map })),
    })),
    segments: source.segments.map((segment) => ({ ...segment })),
  };
}

function resolveMutationTarget(
  clone: StreamerCloneResult,
  targetKind: "variant" | "rendition",
  targetIndex: number,
): StreamerClonedVariant | StreamerClonedRendition {
  const target = targetKind === "variant" ? clone.variants[targetIndex] : clone.renditions[targetIndex];
  if (!target) {
    throw new Error(`invalid mutation target ${targetKind}[${targetIndex}]`);
  }
  return target;
}

async function injectDiscontinuityIntoManifest(manifestPath: string, segmentIndex: number): Promise<void> {
  const text = await fs.readFile(manifestPath, "utf-8");
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let mediaSegmentIndex = 0;
  let pendingExtinfIndex: number | null = null;
  let inserted = false;

  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      pendingExtinfIndex = out.length;
      out.push(line);
      continue;
    }

    if (line.trim() && !line.startsWith("#")) {
      if (mediaSegmentIndex === segmentIndex) {
        const insertAt = pendingExtinfIndex ?? out.length;
        if (out[insertAt - 1] !== "#EXT-X-DISCONTINUITY") {
          out.splice(insertAt, 0, "#EXT-X-DISCONTINUITY");
        }
        inserted = true;
      }
      mediaSegmentIndex += 1;
      pendingExtinfIndex = null;
    }

    out.push(line);
  }

  if (!inserted) {
    throw new Error(`manifest ${manifestPath} has no segment ${segmentIndex}`);
  }
  await fs.writeFile(manifestPath, out.join("\n"), "utf-8");
}

async function applySegmentSwapMutation(params: {
  source: StreamerCloneResult;
  mutated: StreamerCloneResult;
  targetKind: "variant" | "rendition";
  targetIndex: number;
  segmentIndex: number;
  donorOriginId?: string;
  donorTargetKind?: "variant" | "rendition";
  donorTargetIndex?: number;
  donorSegmentIndex?: number;
  withDiscontinuity?: boolean;
  ffmpegProfile?: "hevc";
  createdAt: string;
}): Promise<StreamerOriginFault> {
  const donorOriginId = params.donorOriginId?.trim();
  if (!donorOriginId) {
    throw new Error("segment-swap requires donorOriginId");
  }

  const donorOriginDir = path.join(params.source.rootDir, "..", sanitizeOriginId(donorOriginId));
  const donorRaw = await fs.readFile(path.join(donorOriginDir, "origin.json"), "utf-8");
  const donorParsed = JSON.parse(donorRaw) as StreamerCloneResult;
  const donor = rebaseCloneResult(donorParsed, sanitizeOriginId(donorOriginId), donorOriginDir);
  const donorTargetKind = params.donorTargetKind ?? params.targetKind;
  const donorTargetIndex = Math.max(0, Math.floor(params.donorTargetIndex ?? 0));
  const donorSegmentIndex = Math.max(0, Math.floor(params.donorSegmentIndex ?? params.segmentIndex));
  const target = resolveMutationTarget(params.mutated, params.targetKind, params.targetIndex);
  const donorTarget = resolveMutationTarget(donor, donorTargetKind, donorTargetIndex);
  if (donorSegmentIndex >= donorTarget.segments.length) {
    throw new Error(`${donorTargetKind}[${donorTargetIndex}] has no donor segment ${donorSegmentIndex}`);
  }

  const targetSegment = target.segments[params.segmentIndex];
  const donorSegment = donorTarget.segments[donorSegmentIndex];
  if (donorSegment.map) {
    throw new Error("segment-swap does not support donor segments with EXT-X-MAP yet");
  }

  const targetSegmentPath = path.join(path.dirname(target.manifestPath), targetSegment.localUri);
  const donorSegmentPath = path.join(path.dirname(donorTarget.manifestPath), donorSegment.localUri);
  const donorBytes = params.ffmpegProfile
    ? await transcodeDonorSegmentWithFfmpeg(donorSegmentPath, targetSegmentPath, params.ffmpegProfile)
    : await fs.readFile(donorSegmentPath);
  await fs.writeFile(targetSegmentPath, donorBytes);

  const previousBytes = targetSegment.bytes;
  targetSegment.sourceUri = donorSegment.sourceUri;
  targetSegment.sourceUrl = donorSegment.sourceUrl;
  targetSegment.duration = donorSegment.duration;
  targetSegment.title = donorSegment.title;
  targetSegment.bytes = donorBytes.byteLength;
  targetSegment.map = undefined;

  const byteDelta = donorBytes.byteLength - previousBytes;
  target.bytes += byteDelta;
  params.mutated.bytes += byteDelta;
  target.cumulativeDurationSeconds = target.segments.reduce((sum, segment) => sum + (segment.duration ?? 0), 0);
  target.targetDuration = Math.max(1, ...target.segments.map((segment) => Math.ceil(segment.duration ?? 0)));
  params.mutated.cumulativeDurationSeconds = minVariantDuration(params.mutated.variants);
  params.mutated.targetDuration = Math.max(...params.mutated.variants.map((variant) => variant.targetDuration), 1);

  const manifestBefore = await fs.readFile(target.manifestPath, "utf-8");
  const manifestText = replaceManifestSegmentDuration(manifestBefore, params.segmentIndex, donorSegment.duration);
  await fs.writeFile(target.manifestPath, manifestText, "utf-8");
  if (params.withDiscontinuity) {
    await injectDiscontinuityIntoManifest(target.manifestPath, params.segmentIndex);
  }

  return {
    type: "segment-swap",
    targetKind: params.targetKind,
    targetIndex: params.targetIndex,
    segmentIndex: params.segmentIndex,
    description: `Swapped ${params.targetKind}[${params.targetIndex}] segment ${params.segmentIndex} with ${donor.id} ${donorTargetKind}[${donorTargetIndex}] segment ${donorSegmentIndex}${params.ffmpegProfile ? ` transcoded=${params.ffmpegProfile}` : ""}${params.withDiscontinuity ? " and inserted EXT-X-DISCONTINUITY" : ""}`,
    createdAt: params.createdAt,
    donorOriginId: donor.id,
    donorTargetKind,
    donorTargetIndex,
    donorSegmentIndex,
    withDiscontinuity: Boolean(params.withDiscontinuity),
  };
}

function replaceManifestSegmentDuration(manifestText: string, segmentIndex: number, duration: number | undefined): string {
  if (typeof duration !== "number") {
    return manifestText;
  }
  const lines = manifestText.split(/\r?\n/);
  let mediaSegmentIndex = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#EXTINF:")) {
      continue;
    }
    const nextLine = lines[index + 1];
    if (!nextLine || !nextLine.trim() || nextLine.startsWith("#")) {
      continue;
    }
    if (mediaSegmentIndex === segmentIndex) {
      const title = line.slice("#EXTINF:".length).split(",").slice(1).join(",");
      lines[index] = `#EXTINF:${duration.toFixed(3)},${title}`;
      return `${lines.join("\n")}${manifestText.endsWith("\n") ? "\n" : ""}`;
    }
    mediaSegmentIndex += 1;
  }
  return manifestText;
}

async function transcodeDonorSegmentWithFfmpeg(
  donorSegmentPath: string,
  targetSegmentPath: string,
  profile: "hevc",
): Promise<Buffer> {
  const tempOutputPath = `${targetSegmentPath}.ffmpeg-swap.ts`;
  const args = profile === "hevc"
    ? [
        "-y",
        "-i",
        donorSegmentPath,
        "-c:v",
        "libx265",
        "-preset",
        "ultrafast",
        "-x265-params",
        "keyint=25:min-keyint=25:scenecut=0",
        "-c:a",
        "aac",
        "-f",
        "mpegts",
        tempOutputPath,
      ]
    : [];
  const result = spawnSync("ffmpeg", args, {
    encoding: "utf-8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `ffmpeg exited with ${String(result.status)}`);
  }
  try {
    return await fs.readFile(tempOutputPath);
  } finally {
    await fs.rm(tempOutputPath, { force: true }).catch(() => undefined);
  }
}

function buildProbeCandidates(clone: StreamerCloneResult): StreamerProbeCandidate[] {
  return [
    ...clone.variants.map((variant, index) => ({
      kind: "variant" as const,
      index,
      type: "VIDEO" as const,
      label: formatVariantProbeLabel(variant),
      manifestPath: variant.manifestPath,
    })),
    ...clone.renditions.map((rendition, index) => ({
      kind: "rendition" as const,
      index,
      type: requireRenditionKind(rendition.type),
      label: formatRenditionProbeLabel(rendition),
      manifestPath: rendition.manifestPath,
    })),
  ];
}

function buildAnalyzeCandidates(clone: StreamerCloneResult): StreamerAnalyzeCandidate[] {
  return [
    ...clone.variants.map((variant, index) => ({
      kind: "variant" as const,
      index,
      type: "VIDEO" as const,
      label: formatVariantProbeLabel(variant),
      manifestPath: variant.manifestPath,
      rootPath: path.dirname(variant.manifestPath),
      segments: variant.segments,
    })),
    ...clone.renditions.map((rendition, index) => ({
      kind: "rendition" as const,
      index,
      type: requireRenditionKind(rendition.type),
      label: formatRenditionProbeLabel(rendition),
      manifestPath: rendition.manifestPath,
      rootPath: path.dirname(rendition.manifestPath),
      segments: rendition.segments,
    })),
  ];
}

function sampleSegmentIndices(segmentCount: number, maxSegments: number): number[] {
  if (segmentCount <= 0 || maxSegments <= 0) {
    return [];
  }
  if (segmentCount <= maxSegments) {
    return Array.from({ length: segmentCount }, (_, index) => index);
  }

  const samples = new Set<number>([0, Math.floor((segmentCount - 1) / 2), segmentCount - 1]);
  if (maxSegments >= 4) {
    samples.add(Math.floor(segmentCount / 3));
  }
  if (maxSegments >= 5) {
    samples.add(Math.floor((2 * segmentCount) / 3));
  }

  return [...samples].sort((left, right) => left - right).slice(0, maxSegments);
}

function applyBoundaryAnalysis(candidate: StreamerAnalyzeCandidate, entries: StreamerOriginAnalysisReport["entries"]): void {
  const sorted = [...entries].sort((left, right) => left.segmentIndex - right.segmentIndex);
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];
    if (!previous) {
      current.boundaryStatus = "unknown";
      continue;
    }
    if (typeof current.firstPtsTime !== "number" || typeof previous.firstPtsTime !== "number") {
      current.boundaryStatus = "unknown";
      continue;
    }
    if (current.firstPtsTime <= previous.firstPtsTime) {
      current.boundaryStatus = "reset";
      continue;
    }

    const expectedStart = previous.firstPtsTime + sumDeclaredDurations(
      candidate.segments,
      previous.segmentIndex,
      current.segmentIndex,
    );
    const boundaryDeltaSeconds = current.firstPtsTime - expectedStart;
    current.boundaryDeltaSeconds = boundaryDeltaSeconds;
    current.boundaryStatus = Math.abs(boundaryDeltaSeconds) <= BOUNDARY_DELTA_WARN_SECONDS ? "ok" : "warn";
  }
}

function applyAudioTimestampContinuityAnalysis(
  candidate: StreamerAnalyzeCandidate,
  entries: StreamerOriginAnalysisReport["entries"],
): void {
  if (candidate.type !== "AUDIO") {
    return;
  }

  const sorted = [...entries].sort((left, right) => left.segmentIndex - right.segmentIndex);
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];
    if (!previous) {
      current.continuityStatus = "unknown";
      continue;
    }
    if (current.segmentIndex !== previous.segmentIndex + 1) {
      current.continuityStatus = "unknown";
      continue;
    }
    if (typeof current.firstPtsTime !== "number") {
      current.continuityStatus = "unknown";
      continue;
    }

    const expectedSeconds = calculateExpectedNextAudioPtsSeconds(previous, candidate.segments);
    if (typeof expectedSeconds !== "number") {
      current.continuityStatus = "unknown";
      continue;
    }

    const deltaSeconds = current.firstPtsTime - expectedSeconds;
    current.nextExpectedPtsUs = secondsToMicroseconds(expectedSeconds);
    current.nextActualPtsUs = secondsToMicroseconds(current.firstPtsTime);
    current.nextDeltaUs = secondsToMicroseconds(deltaSeconds);

    if (typeof previous.firstPtsTime === "number" && current.firstPtsTime <= previous.firstPtsTime) {
      current.continuityStatus = "reset";
      continue;
    }
    if (Math.abs(deltaSeconds) <= AUDIO_TIMESTAMP_DELTA_WARN_SECONDS) {
      current.continuityStatus = "ok";
      continue;
    }
    current.continuityStatus = deltaSeconds > 0 ? "gap" : "overlap";
  }
}

function calculateExpectedNextAudioPtsSeconds(
  previous: StreamerOriginAnalysisReport["entries"][number],
  segments: StreamerClonedSegment[],
): number | undefined {
  if (typeof previous.lastPtsTime === "number" && typeof previous.lastSampleDurationSeconds === "number") {
    return previous.lastPtsTime + previous.lastSampleDurationSeconds;
  }
  if (typeof previous.firstPtsTime === "number") {
    const declaredDuration = segments[previous.segmentIndex]?.duration;
    const duration = typeof previous.actualDurationSeconds === "number" ? previous.actualDurationSeconds : declaredDuration;
    if (typeof duration === "number") {
      return previous.firstPtsTime + duration;
    }
  }
  return undefined;
}

function sumDeclaredDurations(segments: StreamerClonedSegment[], fromIndex: number, toIndex: number): number {
  let sum = 0;
  for (let index = fromIndex; index < toIndex; index += 1) {
    sum += segments[index]?.duration ?? 0;
  }
  return sum;
}

function calculateDurationDelta(declared?: number, actual?: number): number | undefined {
  if (typeof declared !== "number" || typeof actual !== "number") {
    return undefined;
  }
  return actual - declared;
}

function buildMediaAnalysisSummaries(entries: StreamerOriginAnalysisReport["entries"]): StreamerMediaAnalysisSummary[] {
  const groups = new Map<string, StreamerOriginAnalysisReport["entries"]>();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.mediaIndex}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    const durationDeltas = group
      .map((entry) => entry.durationDeltaSeconds)
      .filter((value): value is number => typeof value === "number");
    const boundaryDeltas = group
      .map((entry) => entry.boundaryDeltaSeconds)
      .filter((value): value is number => typeof value === "number");
    const maxKeyframeGapSeconds = maxOptional(group.map((entry) => entry.maxKeyframeGapSeconds));
    const startsWithKeyframeFailures = group.filter((entry) => entry.startsWithKeyframe === false).length;

    return {
      kind: first.kind,
      mediaIndex: first.mediaIndex,
      type: first.type,
      label: first.label,
      sampledSegments: group.length,
      durationDeltaMaxSeconds: maxAbsOptional(durationDeltas),
      durationDeltaAverageSeconds: averageAbsOptional(durationDeltas),
      boundaryStatus: summarizeBoundaryStatus(group),
      boundaryDeltaMaxSeconds: maxAbsOptional(boundaryDeltas),
      gopStatus: summarizeGopStatus(first.type, maxKeyframeGapSeconds, startsWithKeyframeFailures),
      maxKeyframeGapSeconds,
      startsWithKeyframeFailures: first.type === "VIDEO" ? startsWithKeyframeFailures : undefined,
    };
  });
}

function buildAvAlignmentSummary(entries: StreamerOriginAnalysisReport["entries"]): StreamerAvAlignmentSummary {
  const videoEntries = entries.filter((entry) => entry.type === "VIDEO" && entry.kind === "variant");
  const audioEntries = entries.filter((entry) => entry.type === "AUDIO");
  const durationDeltas: number[] = [];
  const startPtsDeltas: number[] = [];
  const notes = new Set<string>();
  const timelineDriftWindows = buildAvTimelineDriftWindows(videoEntries, audioEntries);

  for (const video of videoEntries) {
    for (const audio of audioEntries.filter((entry) => entry.segmentIndex === video.segmentIndex)) {
      if (typeof video.actualDurationSeconds === "number" && typeof audio.actualDurationSeconds === "number") {
        durationDeltas.push(Math.abs(video.actualDurationSeconds - audio.actualDurationSeconds));
      }
      if (typeof video.firstPtsTime === "number" && typeof audio.firstPtsTime === "number") {
        const delta = Math.abs(video.firstPtsTime - audio.firstPtsTime);
        if (delta <= 2) {
          startPtsDeltas.push(delta);
        } else {
          notes.add("audio/video PTS clocks look different or reset per segment");
        }
      }
    }
  }

  const maxDurationDeltaSeconds = maxOptional(durationDeltas);
  const maxStartPtsDeltaSeconds = maxOptional(startPtsDeltas);
  const comparedPairs = durationDeltas.length;
  if (comparedPairs === 0) {
    notes.add("no matching audio/video sampled segments");
  }
  if (startPtsDeltas.length === 0) {
    notes.add("PTS start alignment unavailable");
  }
  const maxTimelineDriftSeconds = maxOptional(timelineDriftWindows.map(maxAvTimelineDrift));
  if (timelineDriftWindows.length === 0 && audioEntries.length > 0 && videoEntries.length > 0) {
    notes.add("audio/video manifest timeline windows unavailable");
  }

  const status = comparedPairs === 0 && timelineDriftWindows.length === 0
    ? "unknown"
    : (maxDurationDeltaSeconds !== undefined && maxDurationDeltaSeconds > DURATION_DELTA_WARN_SECONDS) ||
      (maxTimelineDriftSeconds !== undefined && maxTimelineDriftSeconds > AV_TIMELINE_DRIFT_WARN_SECONDS)
    ? "warn"
    : "ok";
  return {
    status,
    comparedPairs,
    maxDurationDeltaSeconds,
    maxStartPtsDeltaSeconds,
    comparedTimelineWindows: timelineDriftWindows.length,
    maxTimelineDriftSeconds,
    timelineDriftWindows: timelineDriftWindows.slice(0, MAX_AV_TIMELINE_DRIFT_WINDOWS),
    notes: [...notes],
  };
}

function buildAvTimelineDriftWindows(
  videoEntries: StreamerOriginAnalysisReport["entries"],
  audioEntries: StreamerOriginAnalysisReport["entries"],
): NonNullable<StreamerAvAlignmentSummary["timelineDriftWindows"]> {
  const sortedVideo = videoEntries
    .filter(hasTimelineWindow)
    .sort(compareMediaEntries);
  const audioGroups = groupEntriesByMediaIndex(audioEntries.filter(hasTimelineWindow));
  const windows: NonNullable<StreamerAvAlignmentSummary["timelineDriftWindows"]> = [];

  for (const video of sortedVideo) {
    for (const [audioMediaIndex, group] of audioGroups) {
      const audio = group.find((entry) => entry.segmentIndex === video.segmentIndex);
      if (!audio || !hasTimelineWindow(audio)) {
        continue;
      }
      const videoDurationSeconds = video.timelineEndSeconds - video.timelineStartSeconds;
      const audioDurationSeconds = audio.timelineEndSeconds - audio.timelineStartSeconds;
      const startDeltaSeconds = audio.timelineStartSeconds - video.timelineStartSeconds;
      const endDeltaSeconds = audio.timelineEndSeconds - video.timelineEndSeconds;
      const durationDeltaSeconds = audioDurationSeconds - videoDurationSeconds;
      const actualDurationDeltaSeconds =
        typeof video.actualDurationSeconds === "number" && typeof audio.actualDurationSeconds === "number"
          ? audio.actualDurationSeconds - video.actualDurationSeconds
          : undefined;
      const maxDriftSeconds = Math.max(
        Math.abs(startDeltaSeconds),
        Math.abs(endDeltaSeconds),
        Math.abs(durationDeltaSeconds),
        Math.abs(actualDurationDeltaSeconds ?? 0),
      );

      windows.push({
        audioMediaIndex,
        videoSegmentIndex: video.segmentIndex,
        audioSegmentIndex: audio.segmentIndex,
        timelineStartSeconds: video.timelineStartSeconds,
        timelineEndSeconds: video.timelineEndSeconds,
        videoDurationSeconds,
        audioDurationSeconds,
        startDeltaSeconds,
        endDeltaSeconds,
        durationDeltaSeconds,
        actualDurationDeltaSeconds,
        status: maxDriftSeconds > AV_TIMELINE_DRIFT_WARN_SECONDS ? "warn" : "ok",
      });
    }
  }

  return windows.sort((left, right) => maxAvTimelineDrift(right) - maxAvTimelineDrift(left));
}

function groupEntriesByMediaIndex(
  entries: StreamerOriginAnalysisReport["entries"],
): Map<number, StreamerOriginAnalysisReport["entries"]> {
  const groups = new Map<number, StreamerOriginAnalysisReport["entries"]>();
  for (const entry of [...entries].sort(compareMediaEntries)) {
    groups.set(entry.mediaIndex, [...(groups.get(entry.mediaIndex) ?? []), entry]);
  }
  return groups;
}

function maxAvTimelineDrift(window: NonNullable<StreamerAvAlignmentSummary["timelineDriftWindows"]>[number]): number {
  return Math.max(
    Math.abs(window.startDeltaSeconds),
    Math.abs(window.endDeltaSeconds),
    Math.abs(window.durationDeltaSeconds),
    Math.abs(window.actualDurationDeltaSeconds ?? 0),
  );
}

function hasTimelineWindow(entry: StreamerOriginAnalysisReport["entries"][number]): entry is StreamerOriginAnalysisReport["entries"][number] & {
  timelineStartSeconds: number;
  timelineEndSeconds: number;
} {
  return typeof entry.timelineStartSeconds === "number" && typeof entry.timelineEndSeconds === "number";
}

function compareMediaEntries(
  left: StreamerOriginAnalysisReport["entries"][number],
  right: StreamerOriginAnalysisReport["entries"][number],
): number {
  return left.segmentIndex - right.segmentIndex;
}

function buildAnalysisIssues(
  entries: StreamerOriginAnalysisReport["entries"],
  media: StreamerMediaAnalysisSummary[],
  avAlignment: StreamerAvAlignmentSummary,
): StreamerOriginAnalysisReport["issues"] {
  const issues: StreamerOriginAnalysisReport["issues"] = [];

  for (const entry of entries) {
    if (!entry.ok) {
      issues.push({
        severity: "error",
        code: "segment_probe_failed",
        summary: `ffprobe failed for ${entry.kind}[${entry.mediaIndex}] seg[${entry.segmentIndex}]`,
        evidence: entry.errors.length > 0 ? entry.errors : [entry.localPath],
      });
    }
    if (
      typeof entry.durationDeltaSeconds === "number" &&
      Math.abs(entry.durationDeltaSeconds) > DURATION_DELTA_WARN_SECONDS
    ) {
      issues.push({
        severity: "warning",
        code: "duration_delta_high",
        summary: `segment duration differs from EXTINF by ${entry.durationDeltaSeconds.toFixed(3)}s`,
        evidence: [
          `${entry.kind}[${entry.mediaIndex}] seg[${entry.segmentIndex}]`,
          `declared=${entry.declaredDurationSeconds?.toFixed(3) ?? "n/a"}s`,
          `actual=${entry.actualDurationSeconds?.toFixed(3) ?? "n/a"}s`,
        ],
      });
    }
    if (
      entry.boundaryStatus === "warn" &&
      typeof entry.boundaryDeltaSeconds === "number"
    ) {
      issues.push({
        severity: "warning",
        code: entry.boundaryDeltaSeconds > 0 ? "segment_boundary_gap" : "segment_boundary_overlap",
        summary: `segment boundary delta is ${entry.boundaryDeltaSeconds.toFixed(3)}s`,
        evidence: [
          `${entry.kind}[${entry.mediaIndex}] seg[${entry.segmentIndex}]`,
          `boundaryDelta=${entry.boundaryDeltaSeconds.toFixed(3)}s`,
        ],
      });
    }
    if (
      entry.type === "AUDIO" &&
      (entry.continuityStatus === "gap" || entry.continuityStatus === "overlap") &&
      typeof entry.nextDeltaUs === "number"
    ) {
      issues.push({
        severity: "warning",
        code: "audio_timestamp_discontinuity",
        summary: `audio timestamp ${entry.continuityStatus} is ${formatMicrosecondsAsMs(entry.nextDeltaUs)}`,
        evidence: [
          `${entry.kind}[${entry.mediaIndex}] seg[${entry.segmentIndex - 1}] -> seg[${entry.segmentIndex}]`,
          `expected=${entry.nextExpectedPtsUs ?? "n/a"}us`,
          `actual=${entry.nextActualPtsUs ?? "n/a"}us`,
          `delta=${formatMicrosecondsAsMs(entry.nextDeltaUs)}`,
        ],
      });
    }
    if (entry.type === "VIDEO" && entry.startsWithKeyframe === false) {
      issues.push({
        severity: "warning",
        code: "segment_not_keyframe_aligned",
        summary: `video segment does not start with a keyframe`,
        evidence: [`${entry.kind}[${entry.mediaIndex}] seg[${entry.segmentIndex}]`],
      });
    }
  }

  for (const item of media) {
    if (item.gopStatus === "warn") {
      issues.push({
        severity: "warning",
        code: "gop_unstable",
        summary: `video GOP looks unstable for ${item.kind}[${item.mediaIndex}]`,
        evidence: [
          `maxKeyframeGap=${item.maxKeyframeGapSeconds?.toFixed(3) ?? "n/a"}s`,
          `startsWithKeyframeFailures=${item.startsWithKeyframeFailures ?? 0}`,
          item.label,
        ],
      });
    }
  }

  if (
    avAlignment.status === "warn" &&
    typeof avAlignment.maxDurationDeltaSeconds === "number"
  ) {
    issues.push({
      severity: "warning",
      code: "av_duration_drift",
      summary: `audio/video sampled segment duration delta reached ${avAlignment.maxDurationDeltaSeconds.toFixed(3)}s`,
      evidence: [
        `comparedPairs=${avAlignment.comparedPairs}`,
        `maxDurationDelta=${avAlignment.maxDurationDeltaSeconds.toFixed(3)}s`,
      ],
    });
  }

  const timelineDriftWindows = avAlignment.timelineDriftWindows?.filter((window) => window.status === "warn") ?? [];
  if (
    timelineDriftWindows.length > 0 &&
    typeof avAlignment.maxTimelineDriftSeconds === "number"
  ) {
    issues.push({
      severity: "warning",
      code: "av_timeline_window_drift",
      summary: `audio/video manifest timeline drift reached ${avAlignment.maxTimelineDriftSeconds.toFixed(3)}s`,
      evidence: [
        `comparedWindows=${avAlignment.comparedTimelineWindows ?? timelineDriftWindows.length}`,
        `maxTimelineDrift=${avAlignment.maxTimelineDriftSeconds.toFixed(3)}s`,
        ...timelineDriftWindows.slice(0, 3).map((window) =>
          `video seg[${window.videoSegmentIndex}] audio[${window.audioMediaIndex}] seg[${window.audioSegmentIndex}] ` +
          `startDelta=${window.startDeltaSeconds.toFixed(3)}s ` +
          `endDelta=${window.endDeltaSeconds.toFixed(3)}s ` +
          `durationDelta=${window.durationDeltaSeconds.toFixed(3)}s`,
        ),
      ],
    });
  }

  return issues;
}

function summarizeBoundaryStatus(entries: StreamerOriginAnalysisReport["entries"]): "ok" | "warn" | "reset" | "unknown" {
  const statuses = entries.map((entry) => entry.boundaryStatus).filter((value): value is NonNullable<typeof value> => Boolean(value));
  if (statuses.includes("warn")) return "warn";
  if (statuses.includes("reset")) return "reset";
  if (statuses.includes("ok")) return "ok";
  return "unknown";
}

function summarizeGopStatus(
  type: "AUDIO" | "SUBTITLES" | "VIDEO",
  maxKeyframeGapSeconds: number | undefined,
  startsWithKeyframeFailures: number,
): "ok" | "warn" | "unknown" | undefined {
  if (type !== "VIDEO") {
    return undefined;
  }
  if (startsWithKeyframeFailures > 0 || (maxKeyframeGapSeconds !== undefined && maxKeyframeGapSeconds > GOP_GAP_WARN_SECONDS)) {
    return "warn";
  }
  return maxKeyframeGapSeconds === undefined ? "unknown" : "ok";
}

function maxOptional(values: Array<number | undefined>): number | undefined {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return filtered.length > 0 ? Math.max(...filtered) : undefined;
}

function maxAbsOptional(values: Array<number | undefined>): number | undefined {
  return maxOptional(values.map((value) => (typeof value === "number" ? Math.abs(value) : undefined)));
}

function averageAbsOptional(values: Array<number | undefined>): number | undefined {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (filtered.length === 0) {
    return undefined;
  }
  return filtered.reduce((sum, value) => sum + Math.abs(value), 0) / filtered.length;
}

function secondsToMicroseconds(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1_000_000) : undefined;
}

function formatMicrosecondsAsMs(value: number): string {
  return `${(value / 1_000).toFixed(3)}ms`;
}

function probeStreamSelectorFor(type: "VIDEO" | RenditionKind): string {
  switch (type) {
    case "VIDEO":
      return "v:0";
    case "AUDIO":
      return "a:0";
    case "SUBTITLES":
      return "s:0";
  }
}

function extractProbeStreamMetadata(streams: unknown[] | undefined): {
  codecName?: string;
  sampleRate?: number;
  channels?: number;
} {
  const stream = Array.isArray(streams) && streams[0] && typeof streams[0] === "object"
    ? streams[0] as Record<string, unknown>
    : undefined;
  if (!stream) {
    return {};
  }
  const sampleRate = typeof stream.sample_rate === "string" || typeof stream.sample_rate === "number"
    ? Number(stream.sample_rate)
    : undefined;
  const channels = typeof stream.channels === "string" || typeof stream.channels === "number"
    ? Number(stream.channels)
    : undefined;
  return {
    codecName: typeof stream.codec_name === "string" ? stream.codec_name : undefined,
    sampleRate: Number.isFinite(sampleRate) ? sampleRate : undefined,
    channels: Number.isFinite(channels) ? channels : undefined,
  };
}

function extractProbeDurationSeconds(format: unknown): number | undefined {
  if (!format || typeof format !== "object") {
    return undefined;
  }
  const duration = (format as { duration?: unknown }).duration;
  if (typeof duration !== "string" && typeof duration !== "number") {
    return undefined;
  }
  const value = Number(duration);
  return Number.isFinite(value) ? value : undefined;
}

function formatVariantProbeLabel(variant: StreamerClonedVariant): string {
  return formatVariantLabel(variant.variant ?? { uri: variant.sourceUri, url: variant.sourceUrl });
}

function formatRenditionProbeLabel(rendition: StreamerClonedRendition): string {
  return [
    rendition.type.toUpperCase(),
    rendition.groupId,
    rendition.name,
    rendition.channels ? `${rendition.channels}ch` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" | ") || rendition.sourceUri;
}

function buildSegmentFileName(index: number, uri: string): string {
  let basename = "";
  try {
    basename = path.basename(new URL(uri, "http://streamer.local").pathname);
  } catch {
    basename = path.basename(uri);
  }

  const safeBase = basename.replace(/[^a-zA-Z0-9._-]/g, "-") || "segment.ts";
  return `${String(index).padStart(5, "0")}-${safeBase}`;
}

function buildVariantDirName(index: number, variant: VariantSource): string {
  let basename = "";
  try {
    basename = path.basename(new URL(variant.uri, "http://streamer.local").pathname);
  } catch {
    basename = path.basename(variant.uri);
  }

  const readable = variant.resolution || basename || `variant-${index}`;
  const safeBase = readable.replace(/[^a-zA-Z0-9._-]/g, "-") || `variant-${index}`;
  return `${String(index).padStart(3, "0")}-${safeBase}`;
}

function buildRenditionDirName(index: number, rendition: RenditionSource): string {
  let basename = "";
  if (rendition.uri) {
    try {
      basename = path.basename(new URL(rendition.uri, "http://streamer.local").pathname);
    } catch {
      basename = path.basename(rendition.uri);
    }
  }

  const fallback = `${renditionDirectory(rendition)}-${index}`;
  const readable = [rendition.groupId, rendition.name].filter(Boolean).join("-") || basename || fallback;
  const safeBase = readable.replace(/[^a-zA-Z0-9._-]/g, "-") || fallback;
  return `${String(index).padStart(3, "0")}-${safeBase}`;
}

function deriveTargetDuration(source: VideoHlsInspectResult, segments: StreamerClonedSegment[]): number {
  if (typeof source.targetDuration === "number" && Number.isFinite(source.targetDuration) && source.targetDuration > 0) {
    return Math.ceil(source.targetDuration);
  }

  const maxDuration = Math.max(
    ...segments.map((segment) => segment.duration).filter((duration): duration is number => typeof duration === "number"),
    1,
  );
  return Math.ceil(maxDuration);
}

function buildLocalMasterPlaylist(
  variants: StreamerClonedVariant[],
  renditions: StreamerClonedRendition[] = [],
): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  const audioGroupIds = renditionGroupIdsFor(renditions, "AUDIO");
  const subtitleGroupIds = renditionGroupIdsFor(renditions, "SUBTITLES");

  for (const rendition of renditions) {
    lines.push(`#EXT-X-MEDIA:${formatRenditionAttrs(rendition, rendition.localUri)}`);
  }

  for (const variant of variants) {
    lines.push(`#EXT-X-STREAM-INF:${formatVariantAttrs(variant, audioGroupIds, subtitleGroupIds)}`);
    lines.push(variant.localUri);
  }

  return `${lines.join("\n")}\n`;
}

function formatVariantAttrs(
  cloned: StreamerClonedVariant,
  availableAudioGroupIds = new Set<string>(),
  availableSubtitleGroupIds = new Set<string>(),
): string {
  const attrs: string[] = [];
  const variant = cloned.variant;

  attrs.push(`BANDWIDTH=${variant?.bandwidth ?? estimateBandwidth(cloned)}`);
  if (typeof variant?.averageBandwidth === "number") {
    attrs.push(`AVERAGE-BANDWIDTH=${variant.averageBandwidth}`);
  }
  if (variant?.resolution) {
    attrs.push(`RESOLUTION=${variant.resolution}`);
  }
  if (typeof variant?.frameRate === "number") {
    attrs.push(`FRAME-RATE=${variant.frameRate}`);
  }
  if (variant?.codecs) {
    attrs.push(`CODECS="${variant.codecs}"`);
  }
  if (variant?.audioGroupId && availableAudioGroupIds.has(variant.audioGroupId)) {
    attrs.push(`AUDIO="${variant.audioGroupId}"`);
  }
  if (variant?.subtitlesGroupId && availableSubtitleGroupIds.has(variant.subtitlesGroupId)) {
    attrs.push(`SUBTITLES="${variant.subtitlesGroupId}"`);
  }
  if (variant?.closedCaptions) {
    attrs.push(`CLOSED-CAPTIONS=${variant.closedCaptions}`);
  }

  return attrs.join(",");
}

function formatRenditionAttrs(rendition: StreamerClonedRendition, uri: string): string {
  const attrs = [
    `TYPE=${rendition.type.toUpperCase()}`,
    ...(rendition.groupId ? [`GROUP-ID=${quoteAttr(rendition.groupId)}`] : []),
    ...(rendition.language ? [`LANGUAGE=${quoteAttr(rendition.language)}`] : []),
    ...(rendition.name ? [`NAME=${quoteAttr(rendition.name)}`] : []),
    ...(typeof rendition.default === "boolean" ? [`DEFAULT=${rendition.default ? "YES" : "NO"}`] : []),
    ...(typeof rendition.autoselect === "boolean" ? [`AUTOSELECT=${rendition.autoselect ? "YES" : "NO"}`] : []),
    ...(typeof rendition.forced === "boolean" ? [`FORCED=${rendition.forced ? "YES" : "NO"}`] : []),
    ...(rendition.characteristics ? [`CHARACTERISTICS=${quoteAttr(rendition.characteristics)}`] : []),
    ...(rendition.channels ? [`CHANNELS=${quoteAttr(rendition.channels)}`] : []),
    `URI=${quoteAttr(uri)}`,
  ];
  return attrs.join(",");
}

function quoteAttr(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function estimateBandwidth(cloned: StreamerClonedVariant): number {
  if (cloned.cumulativeDurationSeconds <= 0) {
    return Math.max(1, cloned.bytes * 8);
  }
  return Math.max(1, Math.ceil((cloned.bytes * 8) / cloned.cumulativeDurationSeconds));
}

function buildLocalMediaPlaylist(params: {
  source: VideoHlsInspectResult;
  segments: StreamerClonedSegment[];
  targetDuration: number;
}): string {
  const mediaSequence = params.source.mediaSequence ?? 0;
  const version = params.segments.some((segment) => segment.map) ? 7 : 3;
  const lines = [
    "#EXTM3U",
    `#EXT-X-VERSION:${version}`,
    `#EXT-X-TARGETDURATION:${params.targetDuration}`,
    `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`,
    ...(typeof params.source.discontinuitySequence === "number"
      ? [`#EXT-X-DISCONTINUITY-SEQUENCE:${params.source.discontinuitySequence}`]
      : []),
  ];

  let activeMapUri: string | null = null;
  for (const segment of params.segments) {
    if (params.source.discontinuityMarkers.includes(segment.originalIndex)) {
      lines.push("#EXT-X-DISCONTINUITY");
      activeMapUri = null;
    }
    if (segment.map && segment.map.localUri !== activeMapUri) {
      lines.push(`#EXT-X-MAP:URI="${segment.map.localUri}"`);
      activeMapUri = segment.map.localUri;
    }
    const duration = segment.duration ?? params.source.targetDuration ?? params.targetDuration;
    lines.push(`#EXTINF:${duration.toFixed(3)},${segment.title ?? ""}`);
    lines.push(segment.localUri);
  }

  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".m3u8") return "application/vnd.apple.mpegurl";
  if (ext === ".ts") return "video/mp2t";
  if (ext === ".m4s") return "video/iso.segment";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".webvtt") return "text/vtt";
  if (ext === ".vtt") return "text/vtt";
  return "application/octet-stream";
}

function sendText(
  response: http.ServerResponse,
  method: string | undefined,
  body: string,
  contentType: string,
): void {
  response.statusCode = 200;
  response.setHeader("content-type", contentType);
  response.setHeader("cache-control", "no-store");
  if (method === "HEAD") {
    response.end();
    return;
  }
  response.end(body);
}

function buildLiveMasterPlaylist(
  variants: StreamerClonedVariant[],
  renditions: StreamerClonedRendition[] = [],
): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  const audioGroupIds = renditionGroupIdsFor(renditions, "AUDIO");
  const subtitleGroupIds = renditionGroupIdsFor(renditions, "SUBTITLES");
  const renditionRefs = buildRenditionRefs(renditions);

  for (const ref of renditionRefs) {
    lines.push(`#EXT-X-MEDIA:${formatRenditionAttrs(ref.rendition, `${liveRenditionPath(ref)}/index.m3u8`)}`);
  }

  for (let index = 0; index < variants.length; index += 1) {
    lines.push(`#EXT-X-STREAM-INF:${formatVariantAttrs(variants[index], audioGroupIds, subtitleGroupIds)}`);
    lines.push(`/live/${index}/index.m3u8`);
  }

  return `${lines.join("\n")}\n`;
}

function buildLiveMediaPlaylist(
  media: ClonedMediaSource,
  pathPrefix: string,
  state: {
    startedAtMs: number;
    windowSize: number;
    initialMediaSequence: number;
  },
  nowMs: number,
): string {
  const currentSequence = currentLiveSequence(media, state, nowMs);
  const version = media.segments.some((segment) => segment.map) ? 7 : 3;
  const mediaSequence = Math.max(
    state.initialMediaSequence,
    currentSequence - state.windowSize + 1,
  );
  const discontinuitySequence = Math.floor(
    Math.max(0, mediaSequence - state.initialMediaSequence) / media.segments.length,
  );
  const lines = [
    "#EXTM3U",
    `#EXT-X-VERSION:${version}`,
    `#EXT-X-TARGETDURATION:${media.targetDuration}`,
    `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence}`,
  ];

  let activeMapUri: string | null = null;
  for (let sequence = mediaSequence; sequence <= currentSequence; sequence += 1) {
    const segment = segmentForSequence(media, sequence);
    const previousSegment =
      sequence > mediaSequence || mediaSequence > state.initialMediaSequence
        ? segmentForSequence(media, sequence - 1)
        : null;
    if (
      segment.originalIndex === 0 &&
      previousSegment !== null &&
      previousSegment.originalIndex !== 0
    ) {
      lines.push("#EXT-X-DISCONTINUITY");
      activeMapUri = null;
    }
    if (segment.map && segment.map.localUri !== activeMapUri) {
      lines.push(`#EXT-X-MAP:URI="${pathPrefix}/${segment.map.localUri}"`);
      activeMapUri = segment.map.localUri;
    }
    const duration = segment.duration ?? media.targetDuration;
    lines.push(`#EXTINF:${duration.toFixed(3)},${segment.title ?? ""}`);
    lines.push(`${pathPrefix}/segments/${sequence}${extensionForSegment(segment)}`);
  }

  return `${lines.join("\n")}\n`;
}

function currentLiveSequence(
  media: ClonedMediaSource,
  state: {
    startedAtMs: number;
    windowSize: number;
    initialMediaSequence: number;
  },
  nowMs: number,
): number {
  const targetMs = Math.max(1, media.targetDuration * 1000);
  const elapsedSegments = Math.max(0, Math.floor((nowMs - state.startedAtMs) / targetMs));
  return state.initialMediaSequence + state.windowSize - 1 + elapsedSegments;
}

function parseVariantIndex(clone: StreamerCloneResult, raw: string | undefined): number {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0 || index >= clone.variants.length) {
    throw new Error("invalid live variant index");
  }
  return index;
}

function parseRenditionIndex(raw: string | undefined): number {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("invalid live rendition index");
  }
  return index;
}

function segmentForSequence(
  media: ClonedMediaSource,
  sequence: number,
): StreamerClonedSegment {
  if (media.segments.length === 0) {
    throw new Error("variant has no segments");
  }
  const index = sequence % media.segments.length;
  return media.segments[index];
}

function resolveClonedSegmentPath(
  rootDir: string,
  media: ClonedMediaSource,
  segment: StreamerClonedSegment,
): string {
  const mediaDir = path.dirname(media.localUri);
  return path.join(rootDir, mediaDir === "." ? "" : mediaDir, segment.localUri);
}

function resolveClonedMapPath(
  rootDir: string,
  media: ClonedMediaSource,
  clonedMap: StreamerClonedMap,
): string {
  const mediaDir = path.dirname(media.localUri);
  return path.join(rootDir, mediaDir === "." ? "" : mediaDir, clonedMap.localUri);
}

function extensionForSegment(segment: StreamerClonedSegment): string {
  const ext = path.extname(segment.localUri);
  return ext || ".ts";
}
