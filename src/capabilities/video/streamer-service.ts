import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VideoDashInspectResult, VideoHlsInspectResult, VideoInspectToolService } from "./inspect-service.js";
import { isBrowserSafeHlsVariant } from "./streamer-diagnostics.js";
import { buildLocalDashMpd } from "./streamer/dash-manifests.js";
import {
  buildLocalMasterPlaylist,
  buildLocalMediaPlaylist,
} from "./streamer/hls-manifests.js";
import { sanitizeOriginId, StreamerOriginStore } from "./streamer/origin-store.js";
import { serveLiveOrigin, serveOrigin } from "./streamer/origin-server.js";
import { mutateOrigin } from "./streamer/mutation.js";
import {
  normalizeAnalyzeOptions,
  normalizeCloneOptions,
  normalizeProbeOptions,
} from "./streamer/options.js";
import { SegmentDownloader } from "./streamer/segment-downloader.js";
import {
  selectDashSegmentWindow,
  selectHlsSegmentWindow,
} from "./streamer/segment-window.js";
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
  StreamerOriginAnalysisReport,
  StreamerOriginProbeReport,
  StreamerOriginSummary,
  StreamerProbeOptions,
  StreamerRemoveResult,
  StreamerServeHandle,
  StreamerServeOptions,
} from "./types.js";

type HlsInspectLike = Pick<VideoInspectToolService, "inspectHls"> &
  Partial<Pick<VideoInspectToolService, "inspectDash">> &
  Partial<Pick<VideoInspectToolService, "probe">>;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type SelectedMediaPlaylist = {
  inspected: VideoHlsInspectResult;
  selectedVariant?: StreamerCloneResult["selectedVariant"];
};

type VariantSource = NonNullable<StreamerClonedVariant["variant"]>;
type RenditionSource = VideoHlsInspectResult["renditions"][number];
type DashRepresentationSource = VideoDashInspectResult["representations"][number];
type RenditionKind = "AUDIO" | "SUBTITLES";
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
type ProgressEmitter = (event: StreamerCloneProgressEvent) => void;

const RENDITION_KIND_CONFIG: Record<RenditionKind, "audio" | "subtitles"> = {
  AUDIO: "audio",
  SUBTITLES: "subtitles",
};

const DURATION_DELTA_WARN_SECONDS = 0.150;
const BOUNDARY_DELTA_WARN_SECONDS = 0.250;
const AUDIO_TIMESTAMP_DELTA_WARN_SECONDS = 0.050;
const AV_TIMELINE_DRIFT_WARN_SECONDS = 0.250;
const MAX_AV_TIMELINE_DRIFT_WINDOWS = 20;
const GOP_GAP_WARN_SECONDS = 3.000;
const STREAMER_ORIGIN_SCHEMA_VERSION = 2;

export class StreamerService {
  private readonly originStore: StreamerOriginStore;
  private readonly downloader: SegmentDownloader;

  constructor(
    private readonly inspect: HlsInspectLike,
    private readonly rootDir: string,
    fetchImpl: FetchLike = fetch,
  ) {
    this.originStore = new StreamerOriginStore(rootDir);
    this.downloader = new SegmentDownloader(fetchImpl);
  }

  async init(): Promise<void> {
    await this.originStore.init();
  }

  async listOrigins(): Promise<StreamerOriginSummary[]> {
    return this.originStore.list();
  }

  async inspectOrigin(originId: string): Promise<StreamerCloneResult> {
    return this.originStore.load(originId);
  }

  async mutateOrigin(input: StreamerMutateInput): Promise<StreamerMutateResult> {
    return mutateOrigin(this.originStore, input);
  }

  async probeOrigin(originId: string, options: StreamerProbeOptions = {}): Promise<StreamerOriginProbeReport> {
    if (!this.inspect.probe) {
      throw new Error("streamer probe requires ffprobe support in VideoInspectToolService");
    }

    const clone = await this.originStore.load(originId);
    const { timeoutMs, maxMediaPlaylists } = normalizeProbeOptions(options);
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

    const clone = await this.originStore.load(originId);
    const {
      timeoutMs,
      startSegment,
      segmentCount,
      maxMediaPlaylists,
      maxSegmentsPerPlaylist,
    } = normalizeAnalyzeOptions(options);
    const candidates = buildAnalyzeCandidates(clone).slice(0, maxMediaPlaylists);
    const entries: StreamerOriginAnalysisReport["entries"] = [];

    for (const candidate of candidates) {
      const candidateEntries: StreamerOriginAnalysisReport["entries"] = [];
      for (const segmentIndex of sampleAnalyzeSegmentIndices(candidate.segments, maxSegmentsPerPlaylist, startSegment, segmentCount)) {
        const segment = candidate.segments[segmentIndex];
        const localPath = path.join(candidate.rootPath, segment.localUri);
        const streamSelector = probeStreamSelectorFor(candidate.type);
        const probeInput = await prepareSegmentProbeInput(candidate.rootPath, segment, localPath);
        let result;
        try {
          result = await this.inspect.probe({
            input: probeInput.input,
            timeoutMs,
            timeline: true,
            streamSelector,
          });
        } finally {
          await probeInput.cleanup();
        }
        const actualDurationSeconds = extractActualSegmentDurationSeconds(result, Boolean(segment.map));
        const streamMetadata = extractProbeStreamMetadata(result.streams);
        candidateEntries.push({
          kind: candidate.kind,
          mediaIndex: candidate.index,
          segmentIndex,
          originalSegmentIndex: segment.originalIndex,
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
    return this.originStore.remove(originId);
  }

  async cloneHls(input: StreamerCloneInput): Promise<StreamerCloneResult> {
    const {
      durationSeconds,
      startSeconds,
      startSegment,
      segmentCount,
      timeoutMs,
      segmentTimeoutMs,
      segmentRetries,
      maxSegments,
    } = normalizeCloneOptions(input);
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
      ...(startSegment !== undefined ? { startSegment } : {}),
      ...(segmentCount !== undefined ? { segmentCount } : {}),
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
            startSegment,
            segmentCount,
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
        startSegment,
        segmentCount,
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
          startSegment,
          segmentCount,
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
          startSegment,
          segmentCount,
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

    const createdAt = new Date().toISOString();
    const result: StreamerCloneResult = {
      id,
      schemaVersion: STREAMER_ORIGIN_SCHEMA_VERSION,
      protocol: "hls",
      sessionKey: input.sessionKey,
      sourceUrl: root.url,
      selectedUrl,
      finalUrl,
      rootDir: originDir,
      manifestPath,
      playbackPath: "/index.m3u8",
      requestedDurationSeconds: durationSeconds,
      requestedStartSeconds: startSeconds > 0 ? startSeconds : undefined,
      requestedStartSegment: startSegment,
      requestedSegmentCount: segmentCount,
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

    await this.originStore.save(result);
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

  async cloneDash(input: StreamerCloneInput): Promise<StreamerCloneResult> {
    if (!this.inspect.inspectDash) {
      throw new Error("streamer DASH clone requires inspectDash support in VideoInspectToolService");
    }

    const {
      durationSeconds,
      startSeconds,
      startSegment,
      segmentCount,
      timeoutMs,
      segmentTimeoutMs,
      segmentRetries,
      maxSegments,
    } = normalizeCloneOptions(input);
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
      ...(startSegment !== undefined ? { startSegment } : {}),
      ...(segmentCount !== undefined ? { segmentCount } : {}),
      allVariants: Boolean(input.allVariants),
    });
    emit({ type: "manifest_fetch", url: input.url });

    const root = await this.inspect.inspectDash({
      url: input.url,
      maxSegments,
      timeoutMs,
    });
    const downloadableRepresentations = root.representations.filter((representation) => representation.segments.length > 0);
    emit({
      type: "manifest_ready",
      url: root.finalUrl,
      playlistType: "dash",
      variantCount: downloadableRepresentations.filter((representation) => representation.contentType === "video").length,
      segmentCount: downloadableRepresentations.reduce((sum, representation) => sum + representation.segments.length, 0),
    });
    if (!root.ok || downloadableRepresentations.length === 0) {
      throw new Error(`DASH inspect failed: ${root.errors.join("; ") || "no downloadable representations"}`);
    }

    const videoRepresentations = downloadableRepresentations.filter((representation) => representation.contentType === "video");
    const primaryRepresentations = videoRepresentations.length > 0 ? videoRepresentations : downloadableRepresentations;
    const selectedVideoRepresentations = input.allVariants
      ? selectDashRepresentations(primaryRepresentations, input.maxVariants)
      : [selectDashRepresentation(primaryRepresentations, input.variant)];
    const selectedVideoIds = new Set(selectedVideoRepresentations.map((representation) => representation.id));
    const renditionRepresentations = downloadableRepresentations.filter((representation) => {
      if (representation.contentType === "video") {
        return false;
      }
      return !selectedVideoIds.has(representation.id);
    });

    const clonedVariants: StreamerClonedVariant[] = [];
    for (let index = 0; index < selectedVideoRepresentations.length; index += 1) {
      const representation = selectedVideoRepresentations[index];
      emit({
        type: "variant_inspect",
        variantIndex: index,
        variantCount: selectedVideoRepresentations.length,
        label: formatDashRepresentationLabel(representation),
        url: representation.baseUrl,
      });
      const localDir = `variants/${buildDashRepresentationDirName(index, representation)}`;
      clonedVariants.push(
        await this.cloneDashRepresentation({
          representation,
          originDir,
          localDir,
          durationSeconds,
          startSeconds,
          startSegment,
          segmentCount,
          segmentTimeoutMs,
          segmentRetries,
          variantIndex: index,
          variantCount: selectedVideoRepresentations.length,
          progress: emit,
        }),
      );
    }

    const clonedRenditions: StreamerClonedRendition[] = [];
    for (let index = 0; index < renditionRepresentations.length; index += 1) {
      const representation = renditionRepresentations[index];
      emit({
        type: "variant_inspect",
        variantIndex: index,
        variantCount: renditionRepresentations.length,
        label: formatDashRepresentationLabel(representation),
        url: representation.baseUrl,
      });
      const kind = dashRenditionKind(representation);
      const localDir = `${kind === "AUDIO" ? "audio" : "subtitles"}/${buildDashRepresentationDirName(index, representation)}`;
      const cloned = await this.cloneDashRepresentation({
        representation,
        originDir,
        localDir,
        durationSeconds,
        startSeconds,
        startSegment,
        segmentCount,
        segmentTimeoutMs,
        segmentRetries,
        variantIndex: index,
        variantCount: renditionRepresentations.length,
        progress: emit,
      });
      clonedRenditions.push({
        type: kind,
        id: representation.id,
        groupId: representation.adaptationSetId,
        name: representation.id ?? kind.toLowerCase(),
        language: representation.lang,
        codecs: representation.codecs,
        mimeType: representation.mimeType,
        bandwidth: representation.bandwidth,
        audioSamplingRate: representation.audioSamplingRate,
        sourceUri: cloned.sourceUri,
        sourceUrl: cloned.sourceUrl,
        finalUrl: cloned.finalUrl,
        localUri: cloned.localUri,
        manifestPath: cloned.manifestPath,
        targetDuration: cloned.targetDuration,
        segmentCount: cloned.segmentCount,
        cumulativeDurationSeconds: cloned.cumulativeDurationSeconds,
        reachedTargetDuration: cloned.reachedTargetDuration,
        bytes: cloned.bytes,
        maps: cloned.maps,
        segments: cloned.segments,
      });
    }

    await fs.writeFile(
      path.join(originDir, "index.mpd"),
      buildLocalDashMpd({
        variants: clonedVariants,
        renditions: clonedRenditions,
        rootRelative: true,
      }),
      "utf-8",
    );

    for (const variant of clonedVariants) {
      await fs.writeFile(
        variant.manifestPath,
        buildLocalDashMpd({ variants: [variant], renditions: [], rootRelative: false }),
        "utf-8",
      );
    }
    for (const rendition of clonedRenditions) {
      await fs.writeFile(
        rendition.manifestPath,
        buildLocalDashMpd({ variants: [], renditions: [rendition], rootRelative: false }),
        "utf-8",
      );
    }

    const clonedSegments = clonedVariants.flatMap((variant) => variant.segments);
    const cumulativeDurationSeconds = minVariantDuration(clonedVariants);
    const targetDuration = Math.max(...clonedVariants.map((variant) => variant.targetDuration), 1);
    const totalBytes =
      clonedVariants.reduce((acc, variant) => acc + variant.bytes, 0) +
      clonedRenditions.reduce((acc, rendition) => acc + rendition.bytes, 0);
    const selectedRepresentation = selectedVideoRepresentations[0];
    const createdAt = new Date().toISOString();
    const result: StreamerCloneResult = {
      id,
      schemaVersion: STREAMER_ORIGIN_SCHEMA_VERSION,
      protocol: "dash",
      sessionKey: input.sessionKey,
      sourceUrl: root.url,
      selectedUrl: selectedRepresentation.baseUrl,
      finalUrl: root.finalUrl,
      rootDir: originDir,
      manifestPath: path.join(originDir, "index.mpd"),
      playbackPath: "/index.mpd",
      requestedDurationSeconds: durationSeconds,
      requestedStartSeconds: startSeconds > 0 ? startSeconds : undefined,
      requestedStartSegment: startSegment,
      requestedSegmentCount: segmentCount,
      cumulativeDurationSeconds,
      reachedTargetDuration: clonedVariants.every((variant) => variant.reachedTargetDuration),
      targetDuration,
      segmentCount: clonedVariants.reduce((acc, variant) => acc + variant.segmentCount, 0),
      variantCount: clonedVariants.length,
      renditionCount: clonedRenditions.length,
      bytes: totalBytes,
      allVariants: Boolean(input.allVariants),
      selectedVariant: dashRepresentationToVariantSource(selectedRepresentation),
      createdAt,
      variants: clonedVariants,
      renditions: clonedRenditions,
      segments: clonedSegments,
    };

    await this.originStore.save(result);
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
    return serveOrigin(this.originStore, originId, options);
  }

  async serveLiveOrigin(
    originId: string,
    options: StreamerLiveServeOptions = {},
  ): Promise<StreamerLiveServeHandle> {
    return serveLiveOrigin(this.originStore, originId, options);
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
    startSegment?: number;
    segmentCount?: number;
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

    const selectedSegments = selectHlsSegmentWindow(params.inspected, {
      startSeconds: params.startSeconds,
      durationSeconds: params.durationSeconds,
      startSegment: params.startSegment,
      segmentCount: params.segmentCount,
    });
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
      const bytes = await this.downloader.fetch({
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
        originalSegmentIndex: selectedSegment.index,
        url: selectedSegment.segment.url,
        duration: selectedSegment.segment.duration,
      });
      const bytes = await this.downloader.fetch({
        url: selectedSegment.segment.url,
        timeoutMs: params.segmentTimeoutMs,
        retries: params.segmentRetries,
        progress: params.progress,
        variantIndex: params.variantIndex,
        variantCount: params.variantCount,
        segmentIndex: index,
        segmentCount: selectedSegments.length,
        originalSegmentIndex: selectedSegment.index,
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
        originalSegmentIndex: selectedSegment.index,
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

  private async cloneDashRepresentation(params: {
    representation: DashRepresentationSource;
    originDir: string;
    localDir: string;
    durationSeconds: number;
    startSeconds: number;
    startSegment?: number;
    segmentCount?: number;
    segmentTimeoutMs: number;
    segmentRetries: number;
    variantIndex: number;
    variantCount: number;
    progress: ProgressEmitter;
  }): Promise<StreamerClonedVariant> {
    const representationDir = params.localDir === "." ? params.originDir : path.join(params.originDir, params.localDir);
    const segmentsDir = path.join(representationDir, "segments");
    await fs.mkdir(segmentsDir, { recursive: true });

    const selectedSegments = selectDashSegmentWindow(
      params.representation,
      {
        startSeconds: params.startSeconds,
        durationSeconds: params.durationSeconds,
        startSegment: params.startSegment,
        segmentCount: params.segmentCount,
      },
    );
    if (selectedSegments.length === 0) {
      throw new Error("streamer DASH clone found no downloadable media segments");
    }

    params.progress({
      type: "variant_ready",
      variantIndex: params.variantIndex,
      variantCount: params.variantCount,
      label: formatDashRepresentationLabel(params.representation),
      segmentCount: selectedSegments.length,
      targetDuration: deriveDashTargetDuration(params.representation),
    });

    let totalBytes = 0;
    let cumulativeDurationSeconds = 0;
    const clonedMaps: StreamerClonedMap[] = [];
    let clonedMap: StreamerClonedMap | undefined;
    if (params.representation.initialization) {
      const localUri = `init/${buildSegmentFileName(0, params.representation.initialization.uri)}`;
      await fs.mkdir(path.dirname(path.join(representationDir, localUri)), { recursive: true });
      const bytes = await this.downloader.fetch({
        url: params.representation.initialization.url,
        timeoutMs: params.segmentTimeoutMs,
        retries: params.segmentRetries,
        progress: () => undefined,
        variantIndex: params.variantIndex,
        variantCount: params.variantCount,
        segmentIndex: 0,
        segmentCount: 0,
      });
      await fs.writeFile(path.join(representationDir, localUri), bytes);
      totalBytes += bytes.byteLength;
      clonedMap = {
        sourceUri: params.representation.initialization.uri,
        sourceUrl: params.representation.initialization.url,
        localUri,
        bytes: bytes.byteLength,
      };
      clonedMaps.push(clonedMap);
    }

    const clonedSegments: StreamerClonedSegment[] = [];
    for (let index = 0; index < selectedSegments.length; index += 1) {
      const selectedSegment = selectedSegments[index];
      const localUri = `segments/${buildSegmentFileName(index, selectedSegment.segment.uri)}`;
      const localPath = path.join(representationDir, localUri);
      params.progress({
        type: "segment_download_start",
        variantIndex: params.variantIndex,
        variantCount: params.variantCount,
        segmentIndex: index,
        segmentCount: selectedSegments.length,
        originalSegmentIndex: selectedSegment.index,
        url: selectedSegment.segment.url,
        duration: selectedSegment.segment.duration,
      });
      const bytes = await this.downloader.fetch({
        url: selectedSegment.segment.url,
        timeoutMs: params.segmentTimeoutMs,
        retries: params.segmentRetries,
        progress: params.progress,
        variantIndex: params.variantIndex,
        variantCount: params.variantCount,
        segmentIndex: index,
        segmentCount: selectedSegments.length,
        originalSegmentIndex: selectedSegment.index,
      });
      await fs.writeFile(localPath, bytes);
      totalBytes += bytes.byteLength;
      cumulativeDurationSeconds += selectedSegment.segment.duration ?? 0;
      clonedSegments.push({
        originalIndex: selectedSegment.index,
        sourceUri: selectedSegment.segment.uri,
        sourceUrl: selectedSegment.segment.url,
        localUri,
        duration: selectedSegment.segment.duration,
        timelineStartSeconds: selectedSegment.timelineStartSeconds,
        timelineEndSeconds: selectedSegment.timelineEndSeconds,
        bytes: bytes.byteLength,
        map: clonedMap,
      });
      params.progress({
        type: "segment_downloaded",
        variantIndex: params.variantIndex,
        variantCount: params.variantCount,
        segmentIndex: index,
        segmentCount: selectedSegments.length,
        originalSegmentIndex: selectedSegment.index,
        localUri,
        bytes: bytes.byteLength,
        cumulativeBytes: totalBytes,
        cumulativeDurationSeconds,
      });
    }

    const targetDuration = deriveDashTargetDuration(params.representation, clonedSegments);
    const manifestPath = path.join(representationDir, "index.mpd");
    return {
      sourceUri: params.representation.id ?? params.representation.baseUrl,
      sourceUrl: params.representation.baseUrl,
      finalUrl: params.representation.baseUrl,
      localUri: params.localDir === "." ? "index.mpd" : `${params.localDir}/index.mpd`,
      manifestPath,
      targetDuration,
      segmentCount: clonedSegments.length,
      cumulativeDurationSeconds,
      reachedTargetDuration: cumulativeDurationSeconds >= params.durationSeconds,
      bytes: totalBytes,
      maps: clonedMaps,
      variant: dashRepresentationToVariantSource(params.representation),
      segments: clonedSegments,
    };
  }

  private async cloneLinkedRenditions(params: {
    root: VideoHlsInspectResult;
    variants: VariantSource[];
    originDir: string;
    durationSeconds: number;
    startSeconds: number;
    startSegment?: number;
    segmentCount?: number;
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
        startSegment: params.startSegment,
        segmentCount: params.segmentCount,
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
  return RENDITION_KIND_CONFIG[requireRenditionKind(rendition.type)];
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

function dashRepresentationToVariantSource(representation: DashRepresentationSource): VariantSource {
  return {
    id: representation.id,
    uri: representation.id ?? representation.baseUrl,
    url: representation.baseUrl,
    contentType: representation.contentType,
    mimeType: representation.mimeType,
    bandwidth: representation.bandwidth,
    resolution:
      typeof representation.width === "number" && typeof representation.height === "number"
        ? `${representation.width}x${representation.height}`
        : undefined,
    frameRate: representation.frameRate,
    codecs: representation.codecs,
  };
}

function selectDashRepresentations(
  representations: DashRepresentationSource[],
  maxVariants: number | undefined,
): DashRepresentationSource[] {
  if (representations.length === 0) {
    throw new Error("DASH MPD has no representations to clone");
  }
  const normalizedMax =
    typeof maxVariants === "number" && Number.isFinite(maxVariants) && maxVariants > 0
      ? Math.floor(maxVariants)
      : representations.length;
  return representations.slice(0, normalizedMax);
}

function selectDashRepresentation(
  representations: DashRepresentationSource[],
  selector: string | undefined,
): DashRepresentationSource {
  if (representations.length === 0) {
    throw new Error("DASH MPD has no representations to clone");
  }
  const normalized = selector?.trim().toLowerCase() || "highest";
  if (normalized === "aac-highest" || normalized === "highest" || normalized === "browser" || normalized === "browser-compatible") {
    return selectHighestBandwidth(representations);
  }
  if (normalized === "aac-lowest" || normalized === "lowest") {
    return selectLowestBandwidth(representations);
  }
  const index = Number(normalized);
  if (Number.isInteger(index) && index >= 0 && index < representations.length) {
    return representations[index];
  }
  throw new Error(`unknown DASH representation selector "${selector}". Use highest, lowest, or a zero-based index.`);
}

function formatVariantLabel(variant: VariantSource): string {
  const parts = [
    variant.resolution,
    typeof variant.bandwidth === "number" ? `${variant.bandwidth}bps` : undefined,
    variant.codecs,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" | ") : variant.uri;
}

function formatDashRepresentationLabel(representation: DashRepresentationSource): string {
  const resolution =
    typeof representation.width === "number" && typeof representation.height === "number"
      ? `${representation.width}x${representation.height}`
      : undefined;
  const parts = [
    representation.contentType,
    resolution,
    typeof representation.bandwidth === "number" ? `${representation.bandwidth}bps` : undefined,
    representation.codecs,
    representation.id,
  ].filter((value): value is string => Boolean(value));
  return parts.join(" | ") || representation.baseUrl;
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

function deriveDashTargetDuration(
  representation: DashRepresentationSource,
  segments: StreamerClonedSegment[] = [],
): number {
  const maxDuration = Math.max(
    ...segments.map((segment) => segment.duration).filter((duration): duration is number => typeof duration === "number"),
    ...representation.segments.map((segment) => segment.duration).filter((duration): duration is number => typeof duration === "number"),
    1,
  );
  return Math.ceil(maxDuration);
}

function dashRenditionKind(representation: DashRepresentationSource): RenditionKind {
  return representation.contentType === "text" ? "SUBTITLES" : "AUDIO";
}

function minVariantDuration(variants: StreamerClonedVariant[]): number {
  if (variants.length === 0) {
    return 0;
  }
  return Math.min(...variants.map((variant) => variant.cumulativeDurationSeconds));
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

async function prepareSegmentProbeInput(
  rootPath: string,
  segment: StreamerClonedSegment,
  segmentPath: string,
): Promise<{ input: string; cleanup(): Promise<void> }> {
  if (!segment.map) {
    return {
      input: segmentPath,
      cleanup: async () => undefined,
    };
  }

  const mapPath = path.join(rootPath, segment.map.localUri);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kael-streamer-probe-"));
  const ext = path.extname(segment.localUri) || ".mp4";
  const tempPath = path.join(tempDir, `segment-with-init${ext === ".dash" ? ".mp4" : ext}`);

  try {
    const [initBytes, segmentBytes] = await Promise.all([
      fs.readFile(mapPath),
      fs.readFile(segmentPath),
    ]);
    await fs.writeFile(tempPath, Buffer.concat([initBytes, segmentBytes]));
    return {
      input: tempPath,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
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

function sampleAnalyzeSegmentIndices(
  segments: StreamerClonedSegment[],
  maxSegments: number,
  startSegment: number | undefined,
  segmentCount: number | undefined,
): number[] {
  const filteredIndexes = segments.flatMap((segment, index) => {
    if (startSegment === undefined && segmentCount === undefined) {
      return [index];
    }
    const windowStart = startSegment ?? 0;
    const windowEnd = segmentCount === undefined ? Number.POSITIVE_INFINITY : windowStart + segmentCount;
    return segment.originalIndex >= windowStart && segment.originalIndex < windowEnd ? [index] : [];
  });
  const sampledPositions = sampleSegmentIndices(filteredIndexes.length, maxSegments);
  return sampledPositions.map((position) => filteredIndexes[position]).filter((index): index is number => index !== undefined);
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

function extractActualSegmentDurationSeconds(
  result: Awaited<ReturnType<NonNullable<HlsInspectLike["probe"]>>>,
  hasInitSegment: boolean,
): number | undefined {
  if (
    hasInitSegment &&
    typeof result.timeline?.firstPtsTime === "number" &&
    typeof result.timeline.lastPtsTime === "number"
  ) {
    const sampleDuration = result.timeline.lastSampleDurationTime ?? 0;
    const duration = result.timeline.lastPtsTime - result.timeline.firstPtsTime + sampleDuration;
    if (Number.isFinite(duration) && duration > 0) {
      return duration;
    }
  }
  return extractProbeDurationSeconds(result.format);
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

function buildDashRepresentationDirName(index: number, representation: DashRepresentationSource): string {
  const resolution =
    typeof representation.width === "number" && typeof representation.height === "number"
      ? `${representation.width}x${representation.height}`
      : undefined;
  const readable =
    [representation.contentType, resolution, representation.id, representation.bandwidth]
      .filter((value): value is string | number => value !== undefined && value !== "")
      .join("-") || `representation-${index}`;
  const safeBase = readable.replace(/[^a-zA-Z0-9._-]/g, "-") || `representation-${index}`;
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
