import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { VideoHlsInspectResult, VideoInspectToolService } from "./inspect-service.js";
import type {
  StreamerCloneInput,
  StreamerCloneProgressEvent,
  StreamerCloneResult,
  StreamerClonedSegment,
  StreamerClonedVariant,
  StreamerLiveServeHandle,
  StreamerLiveServeOptions,
  StreamerOriginSummary,
  StreamerRemoveResult,
  StreamerServeHandle,
  StreamerServeOptions,
} from "./types.js";

type HlsInspectLike = Pick<VideoInspectToolService, "inspectHls">;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type SelectedMediaPlaylist = {
  inspected: VideoHlsInspectResult;
  selectedVariant?: StreamerCloneResult["selectedVariant"];
};

type VariantSource = NonNullable<StreamerClonedVariant["variant"]>;
type ProgressEmitter = (event: StreamerCloneProgressEvent) => void;

const DEFAULT_DURATION_SECONDS = 60;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SEGMENT_TIMEOUT_MS = 60_000;
const DEFAULT_SEGMENT_RETRIES = 2;
const DEFAULT_MAX_SEGMENTS = 200;
const DEFAULT_LIVE_WINDOW_SIZE = 5;
const DEFAULT_INITIAL_MEDIA_SEQUENCE = 100_000;
const STREAMER_ORIGIN_SCHEMA_VERSION = 1;

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
            timeoutMs,
            segmentTimeoutMs,
            segmentRetries,
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
      const manifestText = buildLocalMasterPlaylist(clonedVariants);
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
      clonedVariants = [
        await this.cloneMediaPlaylist({
          inspected: selected.inspected,
          originDir,
          localDir: ".",
          durationSeconds,
          timeoutMs,
          segmentTimeoutMs,
          segmentRetries,
          variant: selected.selectedVariant,
          variantIndex: 0,
          variantCount: 1,
          progress: emit,
        }),
      ];
    }

    const clonedSegments = clonedVariants.flatMap((variant) => variant.segments);
    const cumulativeDurationSeconds = minVariantDuration(clonedVariants);
    const targetDuration = Math.max(...clonedVariants.map((variant) => variant.targetDuration), 1);
    const manifestPath = path.join(originDir, "index.m3u8");
    const totalBytes = clonedVariants.reduce((acc, variant) => acc + variant.bytes, 0);

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
      cumulativeDurationSeconds,
      reachedTargetDuration: clonedVariants.every((variant) => variant.reachedTargetDuration),
      targetDuration,
      segmentCount: clonedVariants.reduce((acc, variant) => acc + variant.segmentCount, 0),
      variantCount: clonedVariants.length,
      bytes: totalBytes,
      allVariants,
      selectedVariant,
      createdAt,
      variants: clonedVariants,
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
      },
    };
  }

  private async cloneMediaPlaylist(params: {
    inspected: VideoHlsInspectResult;
    originDir: string;
    localDir: string;
    durationSeconds: number;
    timeoutMs: number;
    segmentTimeoutMs: number;
    segmentRetries: number;
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

    const selectedSegments = selectSegmentsForDuration(params.inspected, params.durationSeconds);
    if (selectedSegments.length === 0) {
      throw new Error("streamer clone found no downloadable media segments");
    }

    const variantLabel = params.variant ? formatVariantLabel(params.variant) : "media playlist direta";
    params.progress({
      type: "variant_ready",
      variantIndex: params.variantIndex,
      variantCount: params.variantCount,
      label: variantLabel,
      segmentCount: selectedSegments.length,
      targetDuration: params.inspected.targetDuration ?? 0,
    });

    const clonedSegments: StreamerClonedSegment[] = [];
    let totalBytes = 0;
    let cumulativeDurationSeconds = 0;

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
      await fs.writeFile(localPath, bytes);
      totalBytes += bytes.byteLength;
      cumulativeDurationSeconds += selectedSegment.segment.duration ?? params.inspected.targetDuration ?? 0;
      clonedSegments.push({
        originalIndex: selectedSegment.index,
        sourceUri: selectedSegment.segment.uri,
        sourceUrl: selectedSegment.segment.url,
        localUri,
        duration: selectedSegment.segment.duration,
        title: selectedSegment.segment.title,
        bytes: bytes.byteLength,
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
      sourceUri: params.variant?.uri ?? params.inspected.url,
      sourceUrl: params.variant?.url ?? params.inspected.url,
      finalUrl: params.inspected.finalUrl,
      localUri: params.localDir === "." ? "index.m3u8" : `${params.localDir}/index.m3u8`,
      manifestPath,
      targetDuration,
      segmentCount: clonedSegments.length,
      cumulativeDurationSeconds,
      reachedTargetDuration: cumulativeDurationSeconds >= params.durationSeconds,
      bytes: totalBytes,
      variant: params.variant,
      segments: clonedSegments,
    };
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
          clone.variants.length > 1
            ? buildLiveMasterPlaylist(clone.variants)
            : buildLiveMediaPlaylist(clone.variants[0], 0, state, Date.now());
        sendText(response, request.method, body, "application/vnd.apple.mpegurl");
        return;
      }

      const mediaMatch = pathname.match(/^\/live\/(\d+)\/index\.m3u8$/);
      if (mediaMatch) {
        const variantIndex = parseVariantIndex(clone, mediaMatch[1]);
        const variant = clone.variants[variantIndex];
        const body = buildLiveMediaPlaylist(variant, variantIndex, state, Date.now());
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
      const migrated = migrateLegacyCloneResult(parsed, id, originDir);
      if (migrated) {
        return migrated;
      }
      throw new Error(`streamer origin ${id} has no cloned variants`);
    }
    return {
      ...(parsed as StreamerCloneResult),
      id,
      schemaVersion: parsed.schemaVersion ?? STREAMER_ORIGIN_SCHEMA_VERSION,
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

  const normalized = selector?.trim().toLowerCase() || "highest";
  if (normalized === "lowest") {
    return [...root.variants].sort((left, right) => (left.bandwidth ?? Infinity) - (right.bandwidth ?? Infinity))[0];
  }

  if (normalized === "highest") {
    return [...root.variants].sort((left, right) => (right.bandwidth ?? 0) - (left.bandwidth ?? 0))[0];
  }

  const index = Number(normalized);
  if (Number.isInteger(index) && index >= 0 && index < root.variants.length) {
    return root.variants[index];
  }

  throw new Error(`unknown variant selector "${selector}". Use highest, lowest, or a zero-based index.`);
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

function selectSegmentsForDuration(
  inspected: VideoHlsInspectResult,
  durationSeconds: number,
): Array<{ index: number; segment: VideoHlsInspectResult["segments"][number] }> {
  const out: Array<{ index: number; segment: VideoHlsInspectResult["segments"][number] }> = [];
  let cumulativeDuration = 0;

  for (let index = 0; index < inspected.segments.length; index += 1) {
    const segment = inspected.segments[index];
    out.push({ index, segment });
    cumulativeDuration += segment.duration ?? inspected.targetDuration ?? 0;
    if (cumulativeDuration >= durationSeconds) {
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

function migrateLegacyCloneResult(
  parsed: Partial<StreamerCloneResult>,
  originId: string,
  originDir: string,
): StreamerCloneResult | null {
  if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    return null;
  }

  const segments = parsed.segments;
  const targetDuration =
    typeof parsed.targetDuration === "number" && Number.isFinite(parsed.targetDuration)
      ? parsed.targetDuration
      : Math.max(
          ...segments.map((segment) => segment.duration).filter((duration): duration is number => typeof duration === "number"),
          1,
        );
  const cumulativeDurationSeconds =
    typeof parsed.cumulativeDurationSeconds === "number"
      ? parsed.cumulativeDurationSeconds
      : segments.reduce((acc, segment) => acc + (segment.duration ?? targetDuration), 0);
  const bytes =
    typeof parsed.bytes === "number"
      ? parsed.bytes
      : segments.reduce((acc, segment) => acc + segment.bytes, 0);
  const variant: StreamerClonedVariant = {
    sourceUri: parsed.selectedVariant?.uri ?? parsed.selectedUrl ?? parsed.sourceUrl ?? "index.m3u8",
    sourceUrl: parsed.selectedVariant?.url ?? parsed.selectedUrl ?? parsed.sourceUrl ?? "index.m3u8",
    finalUrl: parsed.finalUrl ?? parsed.selectedUrl ?? parsed.sourceUrl ?? "index.m3u8",
    localUri: "index.m3u8",
    manifestPath: path.join(originDir, "index.m3u8"),
    targetDuration,
    segmentCount: segments.length,
    cumulativeDurationSeconds,
    reachedTargetDuration: parsed.reachedTargetDuration ?? true,
    bytes,
    variant: parsed.selectedVariant,
    segments,
  };

  return {
    id: originId,
    schemaVersion: parsed.schemaVersion ?? STREAMER_ORIGIN_SCHEMA_VERSION,
    sessionKey: parsed.sessionKey ?? "legacy.streamer.clone",
    sourceUrl: parsed.sourceUrl ?? variant.sourceUrl,
    selectedUrl: parsed.selectedUrl ?? variant.sourceUrl,
    finalUrl: parsed.finalUrl ?? variant.finalUrl,
    rootDir: originDir,
    manifestPath: path.join(originDir, "index.m3u8"),
    playbackPath: parsed.playbackPath ?? "/index.m3u8",
    requestedDurationSeconds: parsed.requestedDurationSeconds ?? cumulativeDurationSeconds,
    cumulativeDurationSeconds,
    reachedTargetDuration: parsed.reachedTargetDuration ?? true,
    targetDuration,
    segmentCount: segments.length,
    variantCount: 1,
    bytes,
    allVariants: false,
    selectedVariant: parsed.selectedVariant,
    createdAt: parsed.createdAt ?? new Date(0).toISOString(),
    variants: [variant],
    segments,
  };
}

function toOriginSummary(result: StreamerCloneResult): StreamerOriginSummary {
  return {
    id: result.id,
    schemaVersion: result.schemaVersion,
    createdAt: result.createdAt,
    sourceUrl: result.sourceUrl,
    selectedUrl: result.selectedUrl,
    rootDir: result.rootDir,
    playbackPath: result.playbackPath,
    requestedDurationSeconds: result.requestedDurationSeconds,
    cumulativeDurationSeconds: result.cumulativeDurationSeconds,
    reachedTargetDuration: result.reachedTargetDuration,
    targetDuration: result.targetDuration,
    segmentCount: result.segmentCount,
    variantCount: result.variantCount,
    bytes: result.bytes,
    allVariants: result.allVariants,
  };
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

function buildLocalMasterPlaylist(variants: StreamerClonedVariant[]): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];

  for (const variant of variants) {
    lines.push(`#EXT-X-STREAM-INF:${formatVariantAttrs(variant)}`);
    lines.push(variant.localUri);
  }

  return `${lines.join("\n")}\n`;
}

function formatVariantAttrs(cloned: StreamerClonedVariant): string {
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

  return attrs.join(",");
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
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${params.targetDuration}`,
    `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`,
    ...(typeof params.source.discontinuitySequence === "number"
      ? [`#EXT-X-DISCONTINUITY-SEQUENCE:${params.source.discontinuitySequence}`]
      : []),
  ];

  for (const segment of params.segments) {
    if (params.source.discontinuityMarkers.includes(segment.originalIndex)) {
      lines.push("#EXT-X-DISCONTINUITY");
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

function buildLiveMasterPlaylist(variants: StreamerClonedVariant[]): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];

  for (let index = 0; index < variants.length; index += 1) {
    lines.push(`#EXT-X-STREAM-INF:${formatVariantAttrs(variants[index])}`);
    lines.push(`/live/${index}/index.m3u8`);
  }

  return `${lines.join("\n")}\n`;
}

function buildLiveMediaPlaylist(
  variant: StreamerClonedVariant,
  variantIndex: number,
  state: {
    startedAtMs: number;
    windowSize: number;
    initialMediaSequence: number;
  },
  nowMs: number,
): string {
  const currentSequence = currentLiveSequence(variant, state, nowMs);
  const mediaSequence = Math.max(
    state.initialMediaSequence,
    currentSequence - state.windowSize + 1,
  );
  const discontinuitySequence = Math.floor(
    Math.max(0, mediaSequence - state.initialMediaSequence) / variant.segments.length,
  );
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${variant.targetDuration}`,
    `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence}`,
  ];

  for (let sequence = mediaSequence; sequence <= currentSequence; sequence += 1) {
    const segment = segmentForSequence(variant, sequence);
    const previousSegment =
      sequence > mediaSequence || mediaSequence > state.initialMediaSequence
        ? segmentForSequence(variant, sequence - 1)
        : null;
    if (
      segment.originalIndex === 0 &&
      previousSegment !== null &&
      previousSegment.originalIndex !== 0
    ) {
      lines.push("#EXT-X-DISCONTINUITY");
    }
    const duration = segment.duration ?? variant.targetDuration;
    lines.push(`#EXTINF:${duration.toFixed(3)},${segment.title ?? ""}`);
    lines.push(`/live/${variantIndex}/segments/${sequence}${extensionForSegment(segment)}`);
  }

  return `${lines.join("\n")}\n`;
}

function currentLiveSequence(
  variant: StreamerClonedVariant,
  state: {
    startedAtMs: number;
    windowSize: number;
    initialMediaSequence: number;
  },
  nowMs: number,
): number {
  const targetMs = Math.max(1, variant.targetDuration * 1000);
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

function segmentForSequence(
  variant: StreamerClonedVariant,
  sequence: number,
): StreamerClonedSegment {
  if (variant.segments.length === 0) {
    throw new Error("variant has no segments");
  }
  const index = sequence % variant.segments.length;
  return variant.segments[index];
}

function resolveClonedSegmentPath(
  rootDir: string,
  variant: StreamerClonedVariant,
  segment: StreamerClonedSegment,
): string {
  const variantDir = path.dirname(variant.localUri);
  return path.join(rootDir, variantDir === "." ? "" : variantDir, segment.localUri);
}

function extensionForSegment(segment: StreamerClonedSegment): string {
  const ext = path.extname(segment.localUri);
  return ext || ".ts";
}
