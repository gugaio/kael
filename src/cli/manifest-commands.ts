import { Command } from "commander";
import { createKaelApp } from "../app.js";

export function registerManifestCommands(program: Command): void {
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

type ManifestAuditOptions = {
  maxSegments?: string;
  timeoutMs?: string;
  followVariants?: boolean;
  maxVariants?: string;
};

type ManifestDiffOptions = ManifestAuditOptions;


