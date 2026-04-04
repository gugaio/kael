import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { createKaelApp } from "../app.js";
import { startApiServer } from "../api/server.js";
import { loadConfig } from "../config.js";
import { initKaelHome, resolveKaelHome } from "../global-config.js";
import { DiscordChatOnlyBot } from "../integrations/discord/discord-bot.js";

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
    ...(report.recommendations.length > 0
      ? ["recommendations:", ...report.recommendations.map((item) => `- ${item}`)]
      : []),
  ];

  console.log(lines.join("\n"));
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
