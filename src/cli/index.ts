import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { createKaelApp } from "../app.js";
import { startApiServer } from "../api/server.js";
import { loadConfig } from "../config.js";
import { initKaelHome, resolveKaelHome } from "../global-config.js";
import { DiscordChatOnlyBot } from "../integrations/discord/discord-bot.js";
import {
  diagnoseStreamerClone,
  type StreamerCloneDiagnostic,
  type StreamerOriginAnalysisReport,
  type StreamerOriginProbeReport,
  StreamerCloneProgressEvent,
  StreamerCloneResult,
  StreamerClonedRendition,
  StreamerClonedVariant,
  StreamerOriginSummary,
} from "../capabilities/video/index.js";

type UrlOption = {
  url?: string;
};

type ManifestAuditOptions = {
  maxSegments?: string;
  timeoutMs?: string;
  followVariants?: boolean;
  maxVariants?: string;
};

type ManifestDiffOptions = ManifestAuditOptions;

type StreamerCloneOptions = {
  duration?: string;
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

type StreamerRemoveOptions = {
  yes?: boolean;
};

type StreamerAnalyzeOptions = {
  timeoutMs?: string;
  maxMediaPlaylists?: string;
  maxSegmentsPerPlaylist?: string;
};

type StreamerFileProbe = {
  manifestCount: number;
  manifestsOk: number;
  segmentCount: number;
  segmentsOk: number;
  mapCount: number;
  mapsOk: number;
  missing: string[];
};

type StreamerProbeSummary = {
  sampled: number;
  total: number;
  ok: number;
  failed: number;
};

type ApiErrorShape = {
  message?: string;
};

function extractApiErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const legacy = (data as { error?: unknown }).error;
  if (typeof legacy === "string" && legacy.trim()) {
    return legacy;
  }

  if (legacy && typeof legacy === "object") {
    const message = (legacy as ApiErrorShape).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return null;
}

function highlight(text: string): string {
  if (!process.stdout.isTTY) {
    return text;
  }
  return `\x1b[38;5;226m${text}\x1b[0m`;
}

function optionalNumber(value: string | undefined, label: string): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} deve ser numerico`);
  }
  return parsed;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(3)}s`;
}

function createStreamerProgressLogger(): (event: StreamerCloneProgressEvent) => void {
  return (event) => {
    switch (event.type) {
      case "start":
        console.error(
          `[streamer] criando origin ${event.originId} | duration=${event.durationSeconds}s | allVariants=${event.allVariants}`,
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
          `[streamer] baixando segmento ${event.segmentIndex + 1}/${event.segmentCount} da variant ${event.variantIndex + 1}/${event.variantCount}${event.duration ? ` | ${event.duration.toFixed(3)}s` : ""}`,
        );
        return;
      case "segment_download_retry":
        console.error(
          `[streamer] retry segmento ${event.segmentIndex + 1}/${event.segmentCount} da variant ${event.variantIndex + 1}/${event.variantCount} | tentativa ${event.attempt}/${event.maxAttempts} | ${event.error}`,
        );
        return;
      case "segment_downloaded":
        console.error(
          `[streamer] ok segmento ${event.segmentIndex + 1}/${event.segmentCount} | ${formatBytes(event.bytes)} | total=${formatBytes(event.cumulativeBytes)} | duration=${event.cumulativeDurationSeconds.toFixed(3)}s`,
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

async function resolveUrl(explicit?: string): Promise<string> {
  if (explicit) {
    return explicit;
  }

  const cfg = await loadConfig();
  return `http://${cfg.host}:${cfg.port}`;
}

async function commandInit(force: boolean): Promise<void> {
  const result = await initKaelHome(force);

  console.log(`Kael home: ${result.kaelHome}`);
  console.log(`Config: ${result.configPath}`);
  if (result.created) {
    console.log("Global config criado/atualizado com sucesso.");
  } else {
    console.log("Global config ja existia. Use --force para sobrescrever.");
  }

  if (!process.env.KAEL_HOME) {
    const expectedHome = resolveKaelHome();
    console.log(`KAEL_HOME ativo: ${expectedHome}`);
  }
}

type ChatOptions = UrlOption & {
  session: string;
  attach?: string[];
};

type ChatAttachmentPayload = {
  kind: "image" | "audio";
  dataBase64: string;
  mimeType?: string;
  fileName?: string;
};

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};

function inferMimeByPath(filePath: string): string | null {
  const ext = path.extname(filePath).trim().toLowerCase();
  return MIME_BY_EXT[ext] ?? null;
}

function inferKindByMime(mimeType: string): "image" | "audio" | null {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  return null;
}

async function loadChatAttachments(filePaths: string[] | undefined): Promise<ChatAttachmentPayload[]> {
  if (!filePaths || filePaths.length === 0) {
    return [];
  }
  const out: ChatAttachmentPayload[] = [];
  for (const rawPath of filePaths) {
    const filePath = rawPath.trim();
    if (!filePath) {
      continue;
    }
    const mimeType = inferMimeByPath(filePath);
    if (!mimeType) {
      throw new Error(
        `nao foi possivel inferir tipo do anexo: ${filePath}. Use extensao de imagem/audio suportada.`,
      );
    }
    const kind = inferKindByMime(mimeType);
    if (!kind) {
      throw new Error(`anexo nao suportado (apenas image/audio): ${filePath}`);
    }
    const bytes = await fs.readFile(filePath);
    out.push({
      kind,
      dataBase64: bytes.toString("base64"),
      mimeType,
      fileName: path.basename(filePath),
    });
  }
  return out;
}

async function commandChat(message: string, options: ChatOptions): Promise<void> {
  const sessionKey = options.session;
  const url = await resolveUrl(options.url);
  const attachments = await loadChatAttachments(options.attach);

  const response = await fetch(`${url}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey, message, attachments }),
  });

  const data = (await response.json()) as { ok: boolean; reply?: string; error?: unknown };
  if (!response.ok || !data.ok) {
    throw new Error(extractApiErrorMessage(data) ?? `chat failed with status ${response.status}`);
  }

  console.log(data.reply ?? "");
}

async function commandJobs(options: UrlOption): Promise<void> {
  const url = await resolveUrl(options.url);
  const response = await fetch(`${url}/jobs`);
  const data = (await response.json()) as {
    ok: boolean;
    jobs?: Array<{ id: string; capability: string; action: string; status: string; output?: string }>;
    error?: unknown;
  };

  if (!response.ok || !data.ok) {
    throw new Error(extractApiErrorMessage(data) ?? `jobs failed with status ${response.status}`);
  }

  const jobs = data.jobs ?? [];
  if (jobs.length === 0) {
    console.log("Nenhum job encontrado.");
    return;
  }

  for (const job of jobs) {
    console.log(`${job.id} | ${job.capability}/${job.action} | ${job.status} | ${job.output ?? "(sem output)"}`);
  }
}

async function commandJobCancel(
  options: UrlOption & {
    id: string;
  },
): Promise<void> {
  const url = await resolveUrl(options.url);
  const response = await fetch(`${url}/jobs/${options.id}/cancel`, {
    method: "POST",
  });
  const data = (await response.json()) as {
    ok: boolean;
    canceled?: boolean;
    job?: { id: string; status: string };
    error?: unknown;
  };

  if (!response.ok || !data.ok) {
    throw new Error(extractApiErrorMessage(data) ?? `job-cancel failed with status ${response.status}`);
  }

  console.log(
    data.canceled
      ? `Job ${options.id} cancelado.`
      : `Job ${options.id} nao estava cancelavel (status atual: ${data.job?.status ?? "unknown"}).`,
  );
}

async function commandSchedules(options: UrlOption): Promise<void> {
  const url = await resolveUrl(options.url);
  const response = await fetch(`${url}/schedules`);
  const data = (await response.json()) as {
    ok: boolean;
    schedules?: Array<{
      id: string;
      type: string;
      enabled: boolean;
      nextRunAt: string;
      schedule: { kind: "interval"; intervalMs: number } | { kind: "cron"; cronExpr: string };
    }>;
    error?: unknown;
  };

  if (!response.ok || !data.ok) {
    throw new Error(extractApiErrorMessage(data) ?? `schedules failed with status ${response.status}`);
  }

  const schedules = data.schedules ?? [];
  if (schedules.length === 0) {
    console.log("Nenhum schedule encontrado.");
    return;
  }

  for (const schedule of schedules) {
    const scheduleText =
      schedule.schedule.kind === "interval"
        ? `interval=${schedule.schedule.intervalMs}ms`
        : `cron="${schedule.schedule.cronExpr}"`;
    console.log(
      `${schedule.id} | ${schedule.type} | enabled=${schedule.enabled} | ${scheduleText} | next=${schedule.nextRunAt}`,
    );
  }
}

async function commandScheduleUpsert(
  options: UrlOption & {
    id: string;
    type: string;
    enabled?: boolean;
    intervalMs?: string;
    cron?: string;
  },
): Promise<void> {
  const url = await resolveUrl(options.url);
  const intervalMs = options.intervalMs ? Number(options.intervalMs) : undefined;
  const cronExpr = options.cron?.trim();
  const response = await fetch(`${url}/schedules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: options.id,
      type: options.type,
      enabled: options.enabled ?? true,
      intervalMs,
      cronExpr,
    }),
  });
  const data = (await response.json()) as { ok: boolean; schedule?: { id: string }; error?: unknown };
  if (!response.ok || !data.ok) {
    throw new Error(extractApiErrorMessage(data) ?? `schedule-upsert failed with status ${response.status}`);
  }
  console.log(`Schedule salvo: ${data.schedule?.id ?? options.id}`);
}

async function commandScheduleState(
  options: UrlOption & {
    id: string;
  },
  state: "pause" | "resume",
): Promise<void> {
  const url = await resolveUrl(options.url);
  const response = await fetch(`${url}/schedules/${options.id}/${state}`, {
    method: "POST",
  });
  const data = (await response.json()) as { ok: boolean; error?: unknown };
  if (!response.ok || !data.ok) {
    throw new Error(extractApiErrorMessage(data) ?? `schedule-${state} failed with status ${response.status}`);
  }
  console.log(`Schedule ${options.id} ${state === "pause" ? "pausado" : "reativado"}.`);
}

async function commandApprovalsList(
  options: UrlOption & {
    status?: string;
    limit?: string;
  },
): Promise<void> {
  const url = await resolveUrl(options.url);
  const params = new URLSearchParams();
  if (options.status?.trim()) {
    params.set("status", options.status.trim());
  }
  if (options.limit?.trim()) {
    params.set("limit", options.limit.trim());
  }
  const response = await fetch(`${url}/exec/approvals${params.size > 0 ? `?${params.toString()}` : ""}`);
  const data = (await response.json()) as {
    ok: boolean;
    approvals?: Array<{
      id: string;
      status: string;
      command: string;
      cwd: string;
      createdAt: string;
      decidedAt?: string;
    }>;
    error?: unknown;
  };
  if (!response.ok || !data.ok) {
    throw new Error(extractApiErrorMessage(data) ?? `approvals failed with status ${response.status}`);
  }
  const approvals = data.approvals ?? [];
  if (approvals.length === 0) {
    console.log("Nenhuma aprovacao encontrada.");
    return;
  }
  for (const item of approvals) {
    console.log(
      `${item.id} | ${item.status} | ${item.command} | cwd=${item.cwd} | created=${item.createdAt}${
        item.decidedAt ? ` | decided=${item.decidedAt}` : ""
      }`,
    );
  }
}

async function commandApprovalDecision(
  options: UrlOption & {
    id: string;
  },
  decision: "approve" | "deny",
): Promise<void> {
  const url = await resolveUrl(options.url);
  const response = await fetch(`${url}/exec/approvals/${options.id}/${decision}`, { method: "POST" });
  const data = (await response.json()) as {
    ok: boolean;
    approval?: { id: string; status: string };
    error?: unknown;
  };
  if (!response.ok || !data.ok) {
    throw new Error(extractApiErrorMessage(data) ?? `approval-${decision} failed with status ${response.status}`);
  }
  console.log(`Approval ${data.approval?.id ?? options.id} => ${data.approval?.status ?? decision}`);
}

async function commandManifestAudit(
  url: string,
  options: ManifestAuditOptions,
): Promise<void> {
  const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
  const maxSegments = options.maxSegments ? Number(options.maxSegments) : undefined;
  const timeoutMs = options.timeoutMs ? Number(options.timeoutMs) : undefined;
  const maxVariants = options.maxVariants ? Number(options.maxVariants) : undefined;
  const report = await app.manifestAudit.auditHlsManifest({
    sessionKey: "cli.manifest-audit",
    url,
    ...(Number.isFinite(maxSegments) ? { maxSegments } : {}),
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
    ...(options.followVariants ? { followVariants: true } : {}),
    ...(Number.isFinite(maxVariants) ? { maxVariants } : {}),
  });

  const lines = [
    `ok=${report.ok}`,
    `url=${report.url}`,
    `finalUrl=${report.finalUrl}`,
    `playlistType=${report.playlistType}`,
    `summary=${report.summary}`,
    `variants=${report.stats.variants}`,
    `renditions=${report.stats.renditions}`,
    `segments=${report.stats.segments}`,
    `variantsAudited=${report.stats.variantsAudited}`,
    `variantsWithErrors=${report.stats.variantsWithErrors}`,
    ...(typeof report.stats.targetDuration === "number"
      ? [`targetDuration=${report.stats.targetDuration}`]
      : []),
    ...(typeof report.stats.minSegmentDuration === "number"
      ? [`minSegmentDuration=${report.stats.minSegmentDuration.toFixed(3)}`]
      : []),
    ...(typeof report.stats.maxSegmentDuration === "number"
      ? [`maxSegmentDuration=${report.stats.maxSegmentDuration.toFixed(3)}`]
      : []),
    ...(typeof report.stats.averageSegmentDuration === "number"
      ? [`averageSegmentDuration=${report.stats.averageSegmentDuration.toFixed(3)}`]
      : []),
    ...(report.issues.length > 0
      ? ["issues:", ...report.issues.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.summary}`)]
      : ["issues:", "- nenhuma issue relevante detectada"]),
    ...(report.aggregateIssues.length > 0
      ? [
          "aggregateIssues:",
          ...report.aggregateIssues.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.summary}`),
        ]
      : []),
    ...(report.variantAudits.length > 0
      ? [
          "variantAudits:",
          ...report.variantAudits.flatMap((variant) => [
            `- ${variant.uri} | ok=${variant.ok} | playlistType=${variant.playlistType} | segments=${variant.stats.segments} | targetDuration=${variant.stats.targetDuration ?? "n/a"}`,
            ...variant.issues.map((issue) => `  * [${issue.severity}] ${issue.code}: ${issue.summary}`),
          ]),
        ]
      : []),
    ...(report.recommendations.length > 0
      ? ["recommendations:", ...report.recommendations.map((item) => `- ${item}`)]
      : []),
  ];

  console.log(lines.join("\n"));
}

async function commandManifestDiff(
  leftUrl: string,
  rightUrl: string,
  options: ManifestDiffOptions,
): Promise<void> {
  const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
  const maxSegments = options.maxSegments ? Number(options.maxSegments) : undefined;
  const timeoutMs = options.timeoutMs ? Number(options.timeoutMs) : undefined;
  const maxVariants = options.maxVariants ? Number(options.maxVariants) : undefined;
  const report = await app.manifestDiff.diffHlsManifests({
    sessionKey: "cli.manifest-diff",
    leftUrl,
    rightUrl,
    ...(Number.isFinite(maxSegments) ? { maxSegments } : {}),
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
    ...(options.followVariants ? { followVariants: true } : {}),
    ...(Number.isFinite(maxVariants) ? { maxVariants } : {}),
  });

  const lines = [
    `ok=${report.ok}`,
    `summary=${report.summary}`,
    `left.url=${report.left.url}`,
    `right.url=${report.right.url}`,
    `playlistTypeChanged=${report.playlistTypeChanged}`,
    `delta.variants=${report.delta.variants}`,
    `delta.renditions=${report.delta.renditions}`,
    `delta.segments=${report.delta.segments}`,
    `delta.variantsAudited=${report.delta.variantsAudited}`,
    `delta.variantsWithErrors=${report.delta.variantsWithErrors}`,
    `variants.added=${report.variantDiff.added.length}`,
    `variants.removed=${report.variantDiff.removed.length}`,
    `variants.regressed=${report.variantDiff.regressed.length}`,
    `variants.improved=${report.variantDiff.improved.length}`,
    `variants.changed=${report.variantDiff.changed.length}`,
    ...(typeof report.delta.targetDuration === "number" ? [`delta.targetDuration=${report.delta.targetDuration}`] : []),
    ...(typeof report.delta.minSegmentDuration === "number"
      ? [`delta.minSegmentDuration=${report.delta.minSegmentDuration.toFixed(3)}`]
      : []),
    ...(typeof report.delta.maxSegmentDuration === "number"
      ? [`delta.maxSegmentDuration=${report.delta.maxSegmentDuration.toFixed(3)}`]
      : []),
    ...(typeof report.delta.averageSegmentDuration === "number"
      ? [`delta.averageSegmentDuration=${report.delta.averageSegmentDuration.toFixed(3)}`]
      : []),
    ...(report.issueDiff.added.length > 0
      ? ["issues.added:", ...report.issueDiff.added.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.summary}`)]
      : []),
    ...(report.issueDiff.removed.length > 0
      ? ["issues.removed:", ...report.issueDiff.removed.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.summary}`)]
      : []),
    ...(report.aggregateIssueDiff.added.length > 0
      ? [
          "aggregateIssues.added:",
          ...report.aggregateIssueDiff.added.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.summary}`),
        ]
      : []),
    ...(report.aggregateIssueDiff.removed.length > 0
      ? [
          "aggregateIssues.removed:",
          ...report.aggregateIssueDiff.removed.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.summary}`),
        ]
      : []),
    ...(report.variantDiff.regressed.length > 0
      ? [
          "variants.regressed:",
          ...report.variantDiff.regressed.map((item) =>
            `- severity=${item.regressionSeverity} score=${item.regressionScore} ${item.summary}`
          ),
        ]
      : []),
    ...(report.variantDiff.added.length > 0
      ? [
          "variants.added:",
          ...report.variantDiff.added.map((item) =>
            `- severity=${item.regressionSeverity} score=${item.regressionScore} ${item.summary}`
          ),
        ]
      : []),
    ...(report.variantDiff.removed.length > 0
      ? [
          "variants.removed:",
          ...report.variantDiff.removed.map((item) =>
            `- severity=${item.regressionSeverity} score=${item.regressionScore} ${item.summary}`
          ),
        ]
      : []),
    ...(report.recommendations.length > 0
      ? ["recommendations:", ...report.recommendations.map((item) => `- ${item}`)]
      : []),
  ];

  console.log(lines.join("\n"));
}

function formatStreamerOriginSummary(origin: StreamerOriginSummary): string {
  return [
    origin.id,
    `created=${origin.createdAt}`,
    `schema=${origin.schemaVersion}`,
    `variants=${origin.variantCount}`,
    `renditions=${origin.renditionCount}`,
    `segments=${origin.segmentCount}`,
    `duration=${formatSeconds(origin.cumulativeDurationSeconds)}/${origin.requestedDurationSeconds}s`,
    `bytes=${formatBytes(origin.bytes)}`,
    `allVariants=${origin.allVariants}`,
    `source=${origin.sourceUrl}`,
  ].join(" | ");
}

function formatClonedVariantLabel(variant: StreamerClonedVariant): string {
  const parts = [
    variant.variant?.resolution,
    typeof variant.variant?.bandwidth === "number" ? `${variant.variant.bandwidth}bps` : undefined,
    variant.variant?.codecs,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" | ") : variant.sourceUri;
}

function formatClonedRenditionLabel(rendition: StreamerClonedRendition): string {
  return [
    rendition.type.toUpperCase(),
    rendition.groupId,
    rendition.name,
    rendition.channels ? `${rendition.channels}ch` : undefined,
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatUnknownList(values: string[]): string {
  return values.length > 0 ? values.join(",") : "unknown";
}

async function buildStreamerFileProbe(origin: StreamerCloneResult): Promise<StreamerFileProbe> {
  const manifestPaths = new Set([
    origin.manifestPath,
    ...origin.variants.map((variant) => variant.manifestPath),
    ...origin.renditions.map((rendition) => rendition.manifestPath),
  ]);
  const segmentPaths = [
    ...origin.variants.flatMap((variant) =>
      variant.segments.map((segment) => path.join(path.dirname(variant.manifestPath), segment.localUri)),
    ),
    ...origin.renditions.flatMap((rendition) =>
      rendition.segments.map((segment) => path.join(path.dirname(rendition.manifestPath), segment.localUri)),
    ),
  ];
  const mapPaths = [
    ...origin.variants.flatMap((variant) =>
      variant.maps.map((map) => path.join(path.dirname(variant.manifestPath), map.localUri)),
    ),
    ...origin.renditions.flatMap((rendition) =>
      rendition.maps.map((map) => path.join(path.dirname(rendition.manifestPath), map.localUri)),
    ),
  ];

  const manifests = await countExistingFiles([...manifestPaths]);
  const segments = await countExistingFiles([...new Set(segmentPaths)]);
  const maps = await countExistingFiles([...new Set(mapPaths)]);

  return {
    manifestCount: manifestPaths.size,
    manifestsOk: manifests.ok,
    segmentCount: new Set(segmentPaths).size,
    segmentsOk: segments.ok,
    mapCount: new Set(mapPaths).size,
    mapsOk: maps.ok,
    missing: [...manifests.missing, ...segments.missing, ...maps.missing],
  };
}

async function countExistingFiles(filePaths: string[]): Promise<{ ok: number; missing: string[] }> {
  let ok = 0;
  const missing: string[] = [];

  for (const filePath of filePaths) {
    try {
      await fs.access(filePath);
      ok += 1;
    } catch {
      missing.push(filePath);
    }
  }

  return { ok, missing };
}

function formatStreamerDiagnosticSummary(
  diagnostic: StreamerCloneDiagnostic,
  fileProbe: StreamerFileProbe,
  ffprobeSummary?: StreamerProbeSummary,
): string[] {
  const missingCount = fileProbe.missing.length;
  return [
    `diagnostic.browserCompatible=${diagnostic.browserCompatibility}`,
    `diagnostic.compatibleVariants=${diagnostic.browserCompatibleVariantCount}/${diagnostic.variantCount}`,
    `diagnostic.videoCodecs=${formatUnknownList(diagnostic.videoCodecs)}`,
    `diagnostic.audioCodecs=${formatUnknownList(diagnostic.audioCodecs)}`,
    `diagnostic.externalAudio=${diagnostic.externalAudio ? "yes" : "no"}`,
    `diagnostic.externalSubtitles=${diagnostic.externalSubtitles ? "yes" : "no"}`,
    `diagnostic.renditions=audio ${diagnostic.audioRenditionCount}, subtitles ${diagnostic.subtitleRenditionCount}`,
    `diagnostic.files=manifests ${fileProbe.manifestsOk}/${fileProbe.manifestCount}, segments ${fileProbe.segmentsOk}/${fileProbe.segmentCount}, maps ${fileProbe.mapsOk}/${fileProbe.mapCount}`,
    ...(ffprobeSummary
      ? [`diagnostic.ffprobe=ok ${ffprobeSummary.ok}/${ffprobeSummary.sampled} sampled=${ffprobeSummary.sampled}/${ffprobeSummary.total} failed=${ffprobeSummary.failed}`]
      : []),
    `diagnostic.issues=${diagnostic.issues.length + missingCount}`,
  ];
}

function formatStreamerProbeReport(
  origin: StreamerCloneResult,
  diagnostic: StreamerCloneDiagnostic,
  fileProbe: StreamerFileProbe,
  ffprobeReport: StreamerOriginProbeReport,
): string[] {
  return [
    `${highlight("streamer probe")}: ${origin.id}`,
    ...formatStreamerDiagnosticSummary(diagnostic, fileProbe, toStreamerProbeSummary(ffprobeReport)),
    "variants:",
    ...diagnostic.variants.map(
      (variant) =>
        `- [${variant.index}] browser=${variant.browserStatus} | audio=${formatUnknownList(variant.audioCodecs)} | video=${formatUnknownList(variant.videoCodecs)} | group=${variant.audioGroupId ?? "none"} | ${variant.label}`,
    ),
    ...(origin.renditions.length > 0
      ? [
          "renditions:",
          ...origin.renditions.map((rendition, index) => `- [${index}] ${formatClonedRenditionLabel(rendition)}`),
        ]
      : []),
    ...(diagnostic.issues.length > 0 || fileProbe.missing.length > 0
      ? [
          "issues:",
          ...diagnostic.issues.map(
            (issue) => `- [${issue.severity}] ${issue.code}: ${issue.summary} (${issue.evidence.join(" | ")})`,
          ),
          ...fileProbe.missing.map((filePath) => `- [error] missing_file: ${filePath}`),
        ]
      : []),
    ...(ffprobeReport.entries.length > 0
      ? [
          "ffprobe:",
          ...ffprobeReport.entries.map(
            (entry) =>
              `- [${entry.ok ? "ok" : "error"}] ${entry.kind}[${entry.index}] ${entry.type} | streams=${entry.streamCount} | ${entry.label}${entry.errors.length > 0 ? ` | errors=${entry.errors.join(" ; ")}` : ""}`,
          ),
        ]
      : []),
    ...(diagnostic.recommendations.length > 0
      ? ["recommendations:", ...diagnostic.recommendations.map((item) => `- ${item}`)]
      : []),
  ];
}

function toStreamerProbeSummary(report: StreamerOriginProbeReport): StreamerProbeSummary {
  return {
    sampled: report.sampledMediaPlaylists,
    total: report.totalMediaPlaylists,
    ok: report.okCount,
    failed: report.failedCount,
  };
}

function formatStreamerAnalyzeReport(report: StreamerOriginAnalysisReport): string[] {
  return [
    `${highlight("streamer analyze")}: ${report.originId}`,
    `segments=${report.okSegments}/${report.sampledSegments} sampled playlists=${report.sampledMediaPlaylists}/${report.totalMediaPlaylists} failed=${report.failedSegments}`,
    ...report.entries.map((entry) => [
      `- [${entry.ok ? "ok" : "error"}] ${entry.kind}[${entry.mediaIndex}] seg[${entry.segmentIndex}] ${entry.type}`,
      `declared=${entry.declaredDurationSeconds?.toFixed(3) ?? "n/a"}s`,
      `actual=${entry.actualDurationSeconds?.toFixed(3) ?? "n/a"}s`,
      `pts=${entry.firstPtsTime?.toFixed(3) ?? "n/a"} -> ${entry.lastPtsTime?.toFixed(3) ?? "n/a"}`,
      `samples=${entry.packetCount ?? 0}`,
      ...(typeof entry.keyframeCount === "number" ? [`keyframes=${entry.keyframeCount}`] : []),
      ...(typeof entry.startsWithKeyframe === "boolean" ? [`startsWithKeyframe=${entry.startsWithKeyframe ? "yes" : "no"}`] : []),
      ...(typeof entry.maxKeyframeGapSeconds === "number"
        ? [`maxKeyframeGap=${entry.maxKeyframeGapSeconds.toFixed(3)}s`]
        : []),
      entry.label,
      ...(entry.errors.length > 0 ? [`errors=${entry.errors.join(" ; ")}`] : []),
    ].join(" | ")),
  ];
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
    `created=${origin.createdAt}`,
    `source=${origin.sourceUrl}`,
    `selected=${origin.selectedUrl}`,
    `final=${origin.finalUrl}`,
    `variant=${selectedVariant}`,
    `allVariants=${origin.allVariants}`,
    `variants=${origin.variantCount}`,
    `renditions=${origin.renditionCount}`,
    `segments=${origin.segmentCount}`,
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
  const report = await app.streamer.analyzeOrigin(resolvedOriginId, {
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
    ...(Number.isFinite(maxMediaPlaylists) ? { maxMediaPlaylists } : {}),
    ...(Number.isFinite(maxSegmentsPerPlaylist) ? { maxSegmentsPerPlaylist } : {}),
  });

  console.log(formatStreamerAnalyzeReport(report).join("\n"));
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

  const result = await app.streamer.cloneHls({
    sessionKey: "cli.streamer.clone",
    url,
    ...(Number.isFinite(durationSeconds) ? { durationSeconds } : {}),
    ...(options.variant?.trim() ? { variant: options.variant.trim() } : {}),
    ...(allVariants ? { allVariants: true } : {}),
    ...(Number.isFinite(maxVariants) ? { maxVariants } : {}),
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
    ...(Number.isFinite(segmentTimeoutMs) ? { segmentTimeoutMs } : {}),
    ...(Number.isFinite(segmentRetries) ? { segmentRetries } : {}),
    ...(Number.isFinite(maxSegments) ? { maxSegments } : {}),
    ...(options.id?.trim() ? { originId: options.id.trim() } : {}),
    onProgress: logProgress,
  });

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
      `source=${result.sourceUrl}`,
      `selected=${result.selectedUrl}`,
      `variant=${variantText}`,
      `variants=${result.variantCount}`,
      `segments=${result.segmentCount}`,
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

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("kael")
    .description("Kael CLI")
    .showHelpAfterError("(use --help for usage)");

  program
    .command("init")
    .description("Inicializa ~/.kael (ou $KAEL_HOME)")
    .option("-f, --force", "sobrescreve config global existente", false)
    .action(async (options: { force: boolean }) => {
      await commandInit(options.force);
    });

  program
    .command("server")
    .description("Inicia API HTTP local")
    .action(async () => {
      await startApiServer();
    });

  program
    .command("discord-bot")
    .description("Inicia bot Discord (chat-only) usando o core local do Kael")
    .action(async () => {
      // Evita scheduler/email_poll duplicado quando API e Discord rodam em processos separados.
      const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
      const bot = DiscordChatOnlyBot.fromEnv(app);
      const stop = async () => {
        await bot.stop().catch(() => undefined);
        process.exit(0);
      };
      process.on("SIGINT", () => {
        void stop();
      });
      process.on("SIGTERM", () => {
        void stop();
      });
      await bot.start();
      console.log("Discord bot conectado (chat-only).");
      // Mantem processo vivo; o WebSocket/Timers sustentam o event loop.
    });

  program
    .command("manifest-audit")
    .description("Audita manifesto HLS localmente via capability de video")
    .argument("<url>", "URL do manifesto HLS (.m3u8)")
    .option("--max-segments <n>", "quantidade maxima de segmentos considerados no audit")
    .option("--timeout-ms <ms>", "timeout de fetch do manifesto")
    .option("--follow-variants", "segue variants em memoria para auditar media playlists da ladder")
    .option("--max-variants <n>", "limite de variants auditadas quando --follow-variants estiver ativo")
    .action(async (url: string, options: ManifestAuditOptions) => {
      await commandManifestAudit(url, options);
    });

  program
    .command("manifest-diff")
    .description("Compara dois manifestos HLS localmente via capability de video")
    .argument("<leftUrl>", "URL base/referencia do manifesto HLS (.m3u8)")
    .argument("<rightUrl>", "URL candidata/comparada do manifesto HLS (.m3u8)")
    .option("--max-segments <n>", "quantidade maxima de segmentos considerados no audit")
    .option("--timeout-ms <ms>", "timeout de fetch dos manifests")
    .option("--follow-variants", "segue variants em memoria para comparar a ladder dos dois lados")
    .option("--max-variants <n>", "limite de variants auditadas quando --follow-variants estiver ativo")
    .action(async (leftUrl: string, rightUrl: string, options: ManifestDiffOptions) => {
      await commandManifestDiff(leftUrl, rightUrl, options);
    });

  const streamer = program
    .command("streamer")
    .description("Ferramentas locais de clone e origem de streams HLS");

  streamer
    .command("list")
    .description("Lista origins HLS clonados localmente")
    .action(async () => {
      await commandStreamerList();
    });

  streamer
    .command("inspect")
    .description("Mostra metadados de um origin HLS clonado")
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
    .action(async (originId: string | undefined, options: StreamerAnalyzeOptions) => {
      await commandStreamerAnalyze(originId, options);
    });

  streamer
    .command("remove")
    .description("Remove um origin HLS clonado do storage local")
    .argument("<originId>", "id do origin criado por streamer clone")
    .option("--yes", "confirma a remocao do diretorio do origin", false)
    .action(async (originId: string, options: StreamerRemoveOptions) => {
      await commandStreamerRemove(originId, options);
    });

  streamer
    .command("clone")
    .description("Clona uma janela VOD HLS localmente e opcionalmente serve como origem HTTP")
    .argument("<url>", "URL do manifesto HLS (.m3u8)")
    .option("--duration <seconds>", "duracao alvo em segundos (baixa segmentos ate cumulative >= alvo)", "60")
    .option("--variant <selector>", "aac-highest, highest, lowest ou indice zero-based da variant", "aac-highest")
    .option("--all-variants", "clona todas as variants da master playlist e gera uma master local", false)
    .option("--all-variantes", "alias de --all-variants", false)
    .option("--max-variants <n>", "limite opcional de variants quando --all-variants estiver ativo")
    .option("--live", "serve o clone como live sliding window apos clonar (implica --serve)", false)
    .option("--window-size <n>", "quantidade de segmentos na janela live quando --live estiver ativo")
    .option("--initial-media-sequence <n>", "media sequence inicial virtual quando --live estiver ativo")
    .option("--timeout-ms <ms>", "timeout de fetch para manifestos/playlists")
    .option("--segment-timeout-ms <ms>", "timeout de download por segmento (padrao: 60000)")
    .option("--segment-retries <n>", "retries por segmento apos a primeira tentativa (padrao: 2)")
    .option("--max-segments <n>", "limite de segmentos lidos da media playlist")
    .option("--id <id>", "id seguro para o origin local")
    .option("--serve", "inicia servidor HTTP local com CORS apos clonar", false)
    .option("--host <host>", "host do servidor quando --serve estiver ativo", "127.0.0.1")
    .option("--port <port>", "porta do servidor quando --serve estiver ativo (0 = aleatoria)", "0")
    .action(async (url: string, options: StreamerCloneOptions) => {
      await commandStreamerClone(url, options);
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

  program
    .command("chat")
    .description("Envia mensagem para /chat")
    .requiredOption("-m, --message <text>", "mensagem do usuario")
    .option("-s, --session <sessionKey>", "chave da sessao", "main")
    .option(
      "-a, --attach <path>",
      "anexa arquivo de imagem/audio (repita a flag para multiplos anexos)",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(async (options: ChatOptions & { message: string }) => {
      await commandChat(options.message, options);
    });

  program
    .command("jobs")
    .description("Lista jobs")
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(async (options: UrlOption) => {
      await commandJobs(options);
    });

  program
    .command("job-cancel")
    .description("Cancela job em fila ou em execucao")
    .requiredOption("--id <id>", "id do job")
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(async (options: { id: string; url?: string }) => {
      await commandJobCancel(options);
    });

  program
    .command("schedules")
    .description("Lista schedules")
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(async (options: UrlOption) => {
      await commandSchedules(options);
    });

  program
    .command("schedule-upsert")
    .description("Cria/atualiza schedule (intervalo ou cron)")
    .requiredOption("--id <id>", "id do schedule")
    .requiredOption("--type <type>", "tipo do schedule (ex: heartbeat)")
    .option("--interval-ms <ms>", "intervalo em ms")
    .option("--cron <expr>", 'cron expression (5 campos, ex: "*/5 * * * *")')
    .option("--enabled <true|false>", "habilitado", "true")
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(
      async (options: {
        id: string;
        type: string;
        enabled?: string;
        intervalMs?: string;
        cron?: string;
        url?: string;
      }) => {
        await commandScheduleUpsert({
          ...options,
          enabled: options.enabled?.trim().toLowerCase() !== "false",
        });
      },
    );

  program
    .command("schedule-pause")
    .description("Pausa um schedule")
    .requiredOption("--id <id>", "id do schedule")
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(async (options: { id: string; url?: string }) => {
      await commandScheduleState(options, "pause");
    });

  program
    .command("schedule-resume")
    .description("Reativa um schedule")
    .requiredOption("--id <id>", "id do schedule")
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(async (options: { id: string; url?: string }) => {
      await commandScheduleState(options, "resume");
    });

  program
    .command("approvals")
    .description("Lista aprovacoes de exec (pendentes e historico)")
    .option("--status <status>", "filtro: open|pending|approved|denied|expired")
    .option("--limit <n>", "limite de linhas", "100")
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(async (options: { status?: string; limit?: string; url?: string }) => {
      await commandApprovalsList(options);
    });

  program
    .command("approval-approve")
    .description("Aprova uma solicitacao de exec")
    .requiredOption("--id <id>", "id da aprovacao")
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(async (options: { id: string; url?: string }) => {
      await commandApprovalDecision(options, "approve");
    });

  program
    .command("approval-deny")
    .description("Nega uma solicitacao de exec")
    .requiredOption("--id <id>", "id da aprovacao")
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(async (options: { id: string; url?: string }) => {
      await commandApprovalDecision(options, "deny");
    });

  if (process.argv.slice(2).length === 0) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Kael error: ${message}`);
  process.exitCode = 1;
});
