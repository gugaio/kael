import fs from "node:fs/promises";
import path from "node:path";
import type {
  HlsWatchService,
  HlsWatchStatus,
  StreamerAnalyzeOptions,
  StreamerCloneInput,
  StreamerCloneProgressEvent,
  StreamerCloneResult,
  StreamerOriginAnalysisReport,
} from "@gugaio/vhs";
import type {
  StreamWatchChunkStatus,
  StreamWatchEvent,
  StreamWatchParams,
  StreamWatchStatus,
} from "./types.js";

type StreamerRuntime = {
  cloneHls(input: StreamerCloneInput): Promise<StreamerCloneResult>;
  analyzeOrigin(originId: string, options?: StreamerAnalyzeOptions): Promise<StreamerOriginAnalysisReport>;
  removeOrigin(originId: string): Promise<unknown>;
};

type StoredWatch = StreamWatchStatus & {
  rootDir?: string;
};

const DEFAULT_LIVE_DURATION_MS = 60 * 60 * 1000;
const DEFAULT_RETENTION_HOURS = 24;
const MAX_RECENT_CHUNKS = 5;

/**
 * Adapta o monitor HLS do VHS ao contrato de sessao do Kael.
 *
 * `profile=manifest` continua usando o watcher leve do VHS. `chunks` e `full`
 * criam uma sessão persistida que baixa uma janela local e roda análise por
 * segmento com o streamer/VHS.
 */
export class HlsStreamMonitorService {
  private readonly sessionKeys = new Map<string, string>();
  private readonly richSessions = new Map<string, StoredWatch>();
  private readonly removedManifestSessions = new Set<string>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly watch: HlsWatchService,
    private readonly streamer: StreamerRuntime,
    private readonly rootDir: string,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    await this.loadStoredSessions();
    await this.cleanupExpired();
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpired();
    }, 60 * 60 * 1000);
  }

  startWatch(params: StreamWatchParams): string {
    const profile = params.profile ?? "manifest";
    if (profile === "manifest" || params.mode === "live") {
      const id = this.watch.startWatch({
        url: params.url,
        profile,
        mode: params.mode,
        pollIntervalMs: params.pollIntervalMs,
        maxPollCount: params.maxPollCount,
        timeoutMs: params.timeoutMs,
        maxEvents: params.maxEvents,
        maxDurationMs: params.maxDurationMs,
        retentionHours: params.retentionHours,
        variantSelector: params.variantSelector,
        allVariants: params.allVariants,
      });
      this.sessionKeys.set(id, params.sessionKey);
      return id;
    }

    const id = `watch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const session: StoredWatch = {
      id,
      sessionKey: params.sessionKey,
      url: params.url,
      profile,
      mode: params.mode ?? "auto",
      inputType: params.mode === "vod" ? "vod" : "unknown",
      state: "running",
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (params.retentionHours ?? DEFAULT_RETENTION_HOURS) * 60 * 60 * 1000).toISOString(),
      lastPollAt: null,
      pollCount: 0,
      errorCount: 0,
      downloadedSegmentCount: 0,
      analyzedSegmentCount: 0,
      recentChunks: [],
      manifestReports: [],
      abrReports: [],
      events: [],
      running: true,
      rootDir: path.join(this.rootDir, id),
    };
    this.richSessions.set(id, session);
    void this.persistSession(session);
    void this.runRichWatch(session, params);
    return id;
  }

  stopWatch(id: string): boolean {
    const rich = this.richSessions.get(id);
    if (rich) {
      rich.running = false;
      rich.state = rich.state === "running" ? "stopped" : rich.state;
      rich.completedAt = rich.completedAt ?? new Date().toISOString();
      void this.persistSession(rich);
      return true;
    }
    return this.watch.stopWatch(id);
  }

  async removeWatch(id: string): Promise<boolean> {
    const stopped = this.stopWatch(id);
    const rich = this.richSessions.get(id);
    if (rich) {
      this.richSessions.delete(id);
      if (rich.originId) {
        await this.streamer.removeOrigin(rich.originId).catch(() => undefined);
      }
      await fs.rm(path.join(this.rootDir, id), { recursive: true, force: true });
      return true;
    }
    if (stopped) {
      this.removedManifestSessions.add(id);
      this.sessionKeys.delete(id);
    }
    return stopped;
  }

  getStatus(id: string): StreamWatchStatus | null {
    if (this.removedManifestSessions.has(id)) return null;
    const rich = this.richSessions.get(id);
    if (rich) return toPublicStatus(rich);
    const status = this.watch.getStatus(id);
    return status ? this.toKaelStatus(status) : null;
  }

  listWatches(): StreamWatchStatus[] {
    return [
      ...this.watch
        .listWatches()
        .filter((status) => !this.removedManifestSessions.has(status.id))
        .map((status) => this.toKaelStatus(status)),
      ...[...this.richSessions.values()].map(toPublicStatus),
    ].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  stopAll(): void {
    this.watch.stopAll();
    for (const session of this.richSessions.values()) {
      if (session.running) {
        session.running = false;
        session.state = "stopped";
        session.completedAt = new Date().toISOString();
        void this.persistSession(session);
      }
    }
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private async runRichWatch(session: StoredWatch, params: StreamWatchParams): Promise<void> {
    try {
      await this.appendEvent(session, {
        code: "watch_started",
        severity: "info",
        summary: `Watch ${session.profile} iniciado`,
        evidence: [`url=${session.url}`],
        detectedAt: new Date().toISOString(),
      });

      const durationSeconds = Math.max(
        1,
        Math.floor((params.maxDurationMs ?? DEFAULT_LIVE_DURATION_MS) / 1000),
      );
      const originId = `watch-${session.id}`;
      const clone = await this.streamer.cloneHls({
        url: params.url,
        originId,
        durationSeconds,
        allVariants: params.allVariants ?? false,
        variant: params.variantSelector,
        timeoutMs: params.timeoutMs,
        onProgress: (event) => {
          void this.handleCloneProgress(session, event);
        },
      });

      session.originId = clone.id;
      session.inputType = params.mode === "live" ? "live" : params.mode === "vod" ? "vod" : "unknown";
      session.downloadedSegmentCount = clone.segmentCount;
      session.totalSegmentCount = clone.segmentCount;
      session.pollCount = 1;
      session.lastPollAt = new Date().toISOString();
      await this.persistSession(session);

      const report = await this.streamer.analyzeOrigin(clone.id, {
        full: true,
        timeoutMs: params.timeoutMs,
        maxMediaPlaylists: session.profile === "full" ? 20 : 4,
      });
      session.analyzedSegmentCount = report.sampledSegments;
      this.applyAnalysisProgress(session, report);
      session.report = {
        jsonPath: path.join(session.rootDir ?? this.rootDir, "report.json"),
        htmlPath: path.join(session.rootDir ?? this.rootDir, "report.html"),
      };
      for (const issue of report.issues) {
        session.events.push({
          code: issue.code,
          severity: issue.severity,
          summary: issue.summary,
          evidence: issue.evidence,
          detectedAt: new Date().toISOString(),
        });
      }
      await this.writeReport(session, report);

      session.running = false;
      session.state = report.ok ? "completed" : "failed";
      session.completedAt = new Date().toISOString();
      await this.persistSession(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.errorCount += 1;
      session.running = false;
      session.state = "failed";
      session.completedAt = new Date().toISOString();
      session.events.push({
        code: "watch_failed",
        severity: "error",
        summary: `Watch falhou: ${message}`,
        evidence: [`url=${session.url}`, `error=${message}`],
        detectedAt: new Date().toISOString(),
      });
      await this.persistSession(session);
    }
  }

  private async handleCloneProgress(
    session: StoredWatch,
    event: StreamerCloneProgressEvent,
  ): Promise<void> {
    if (!session.running) return;
    session.lastPollAt = new Date().toISOString();
    session.pollCount = Math.max(1, session.pollCount);

    if (event.type === "manifest_ready") {
      session.totalSegmentCount = event.segmentCount;
      await this.appendEvent(session, {
        code: "manifest_ready",
        severity: "info",
        summary: `Manifesto pronto: ${event.playlistType}, ${event.segmentCount} segmentos`,
        evidence: [`url=${event.url}`, `variants=${event.variantCount}`],
        detectedAt: new Date().toISOString(),
      });
      return;
    }

    if (event.type === "variant_ready") {
      session.totalSegmentCount = Math.max(session.totalSegmentCount ?? 0, event.segmentCount);
      await this.persistSession(session);
      return;
    }

    if (event.type === "segment_download_start") {
      const chunk = upsertChunk(session, {
        id: chunkId(event.variantIndex, event.segmentIndex),
        phase: "downloading",
        variantIndex: event.variantIndex,
        variantCount: event.variantCount,
        segmentIndex: event.segmentIndex,
        segmentCount: event.segmentCount,
        originalSegmentIndex: event.originalSegmentIndex,
        url: event.url,
        startedAt: new Date().toISOString(),
        durationSeconds: event.duration,
        errors: [],
      });
      session.currentChunk = chunk;
      await this.persistSession(session);
      return;
    }

    if (event.type === "segment_downloaded") {
      const now = new Date().toISOString();
      session.downloadedSegmentCount += 1;
      session.totalSegmentCount = Math.max(session.totalSegmentCount ?? 0, event.segmentCount);
      const chunk = upsertChunk(session, {
        id: chunkId(event.variantIndex, event.segmentIndex),
        phase: "downloaded",
        variantIndex: event.variantIndex,
        variantCount: event.variantCount,
        segmentIndex: event.segmentIndex,
        segmentCount: event.segmentCount,
        originalSegmentIndex: event.originalSegmentIndex,
        localUri: event.localUri,
        downloadedAt: now,
        bytes: event.bytes,
        errors: [],
      });
      session.currentChunk = chunk;
      await this.persistSession(session);
      return;
    }

    if (event.type === "segment_download_retry") {
      session.errorCount += 1;
      const chunk = upsertChunk(session, {
        id: chunkId(event.variantIndex, event.segmentIndex),
        phase: "downloading",
        variantIndex: event.variantIndex,
        variantCount: event.variantCount,
        segmentIndex: event.segmentIndex,
        segmentCount: event.segmentCount,
        originalSegmentIndex: event.originalSegmentIndex,
        errors: [event.error],
      });
      session.currentChunk = chunk;
      await this.appendEvent(session, {
        code: "segment_download_retry",
        severity: "warning",
        summary: `Retry no segmento ${event.segmentIndex}: ${event.error}`,
        evidence: [
          `variant=${event.variantIndex + 1}/${event.variantCount}`,
          `segment=${event.segmentIndex + 1}/${event.segmentCount}`,
          `attempt=${event.attempt}/${event.maxAttempts}`,
        ],
        detectedAt: new Date().toISOString(),
      });
      return;
    }

    await this.persistSession(session);
  }

  private applyAnalysisProgress(
    session: StoredWatch,
    report: StreamerOriginAnalysisReport,
  ): void {
    const now = new Date().toISOString();
    for (const entry of report.entries) {
      const chunk = upsertChunk(session, {
        id: chunkId(entry.mediaIndex, entry.segmentIndex),
        phase: entry.ok ? "analyzed" : "failed",
        variantIndex: entry.mediaIndex,
        variantCount: report.totalMediaPlaylists,
        segmentIndex: entry.segmentIndex,
        segmentCount: report.sampledSegments,
        originalSegmentIndex: entry.originalSegmentIndex,
        analyzedAt: now,
        codecName: entry.codecName,
        streamSelector: entry.streamSelector,
        actualDurationSeconds: entry.actualDurationSeconds,
        durationDeltaSeconds: entry.durationDeltaSeconds,
        continuityStatus: entry.continuityStatus,
        keyframeCount: entry.keyframeCount,
        startsWithKeyframe: entry.startsWithKeyframe,
        errors: entry.errors,
      });
      session.currentChunk = chunk;
    }
  }

  private toKaelStatus(status: HlsWatchStatus): StreamWatchStatus {
    const richStatus = status as HlsWatchStatus & Pick<StreamWatchStatus, "manifestReports" | "abrReports">;
    return {
      ...status,
      sessionKey: this.sessionKeys.get(status.id) ?? "unknown",
      profile: status.profile ?? "manifest",
      mode: status.mode ?? "auto",
      inputType: status.inputType ?? "unknown",
      state: status.state ?? (status.running ? "running" : "stopped"),
      downloadedSegmentCount: status.downloadedSegmentCount ?? 0,
      analyzedSegmentCount: status.analyzedSegmentCount ?? 0,
      recentChunks: status.recentChunks ?? [],
      manifestReports: richStatus.manifestReports ?? [],
      abrReports: richStatus.abrReports ?? [],
    };
  }

  private async appendEvent(session: StoredWatch, event: StreamWatchEvent): Promise<void> {
    session.events.push(event);
    await fs.mkdir(session.rootDir ?? this.rootDir, { recursive: true });
    await fs.appendFile(path.join(session.rootDir ?? this.rootDir, "events.jsonl"), `${JSON.stringify(event)}\n`);
    await this.persistSession(session);
  }

  private async writeReport(session: StoredWatch, report: StreamerOriginAnalysisReport): Promise<void> {
    const root = session.rootDir ?? path.join(this.rootDir, session.id);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(path.join(root, "report.html"), renderReportHtml(session, report));
  }

  private async persistSession(session: StoredWatch): Promise<void> {
    const root = session.rootDir ?? path.join(this.rootDir, session.id);
    session.rootDir = root;
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "watch.json"), `${JSON.stringify(session, null, 2)}\n`);
  }

  private async loadStoredSessions(): Promise<void> {
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(this.rootDir, entry.name, "watch.json");
      try {
        const parsed = JSON.parse(await fs.readFile(file, "utf-8")) as StoredWatch;
        parsed.running = false;
        if (parsed.state === "running") {
          parsed.state = "stopped";
          parsed.completedAt = parsed.completedAt ?? new Date().toISOString();
        }
        parsed.recentChunks ??= [];
        parsed.manifestReports ??= [];
        parsed.abrReports ??= [];
        parsed.rootDir = path.join(this.rootDir, entry.name);
        this.richSessions.set(parsed.id, parsed);
      } catch {
        // Ignore corrupt watch metadata; cleanup can remove the directory later.
      }
    }
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    for (const session of [...this.richSessions.values()]) {
      if (!session.expiresAt || Date.parse(session.expiresAt) > now || session.running) continue;
      await this.removeWatch(session.id);
    }
  }
}

function toPublicStatus(session: StoredWatch): StreamWatchStatus {
  const { rootDir: _rootDir, ...status } = session;
  return status;
}

function chunkId(variantIndex: number, segmentIndex: number): string {
  return `${variantIndex}:${segmentIndex}`;
}

function upsertChunk(
  session: StoredWatch,
  next: StreamWatchChunkStatus,
): StreamWatchChunkStatus {
  const existing = session.recentChunks.find((chunk) => chunk.id === next.id);
  const merged: StreamWatchChunkStatus = {
    ...(existing ?? next),
    ...next,
    errors: [...new Set([...(existing?.errors ?? []), ...next.errors])],
  };
  const rest = session.recentChunks.filter((chunk) => chunk.id !== next.id);
  session.recentChunks = [...rest, merged].slice(-MAX_RECENT_CHUNKS);
  return merged;
}

function renderReportHtml(session: StreamWatchStatus, report: StreamerOriginAnalysisReport): string {
  const issues = report.issues
    .map((issue) => `<tr><td>${escapeHtml(issue.severity)}</td><td>${escapeHtml(issue.code)}</td><td>${escapeHtml(issue.summary)}</td></tr>`)
    .join("");
  const rows = report.entries
    .slice(0, 500)
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(`${entry.kind}[${entry.mediaIndex}]`)}</td><td>${entry.segmentIndex}</td><td>${escapeHtml(entry.streamSelector ?? "")}</td><td>${entry.ok ? "ok" : "fail"}</td><td>${escapeHtml(entry.codecName ?? "")}</td><td>${entry.actualDurationSeconds?.toFixed(3) ?? ""}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Kael Stream Watch ${escapeHtml(session.id)}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#172033}table{border-collapse:collapse;width:100%;margin-top:12px}td,th{border:1px solid #d7dce5;padding:6px 8px;text-align:left;font-size:13px}th{background:#f4f6f9}.meta{color:#667085}</style></head>
<body><h1>Stream Watch Report</h1><p class="meta">${escapeHtml(session.url)}</p>
<p>status=${escapeHtml(session.state)} profile=${escapeHtml(session.profile)} downloaded=${session.downloadedSegmentCount} analyzed=${session.analyzedSegmentCount}</p>
<h2>Issues</h2><table><thead><tr><th>Severity</th><th>Code</th><th>Summary</th></tr></thead><tbody>${issues}</tbody></table>
<h2>Segments</h2><table><thead><tr><th>Media</th><th>Segment</th><th>Stream</th><th>Status</th><th>Codec</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
