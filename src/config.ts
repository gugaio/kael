import path from "node:path";
import fs from "node:fs/promises";
import { expandHome, loadGlobalConfig } from "./global-config.js";
import type { ExecAsk, ExecSecurity } from "./shell/approvals.js";

export type EngineMode = "simple" | "pi" | "hybrid";

export type PiEngineConfig = {
  enabled: boolean;
  provider: string;
  systemPrompt: string;
  systemPromptSource?: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  retry: {
    attempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitterMs: number;
  };
};

export type KaelConfig = {
  port: number;
  host: string;
  dataDir: string;
  api: {
    authToken?: string;
  };
  engineMode: EngineMode;
  context: {
    maxMessages: number;
    maxChars: number;
  };
  idempotency: {
    enabled: boolean;
    ttlMs: number;
  };
  automation: {
    heartbeatEnabled: boolean;
    heartbeatIntervalMs: number;
    plannerReconcileEnabled: boolean;
    plannerReconcileIntervalMs: number;
    schedulerTickMs: number;
  };
  execution: {
    safePathsEnabled: boolean;
    allowedPaths: string[];
    maxJobArgs: number;
    maxConcurrentJobs: number;
    jobTimeoutMs: number;
    killGraceMs: number;
  };
  shell: {
    workspaceRoot: string;
    defaultTimeoutMs: number;
    noOutputTimeoutMs: number;
    maxTimeoutMs: number;
    maxOutputChars: number;
    approvalWaitMs: number;
    /** Milissegundos entre SIGTERM e SIGKILL ao encerrar processos. */
    killGraceMs: number;
    /** Milissegundos a aguardar antes de fazer background automático (0 = desligado). */
    defaultYieldMs: number;
    security: ExecSecurity;
    ask: ExecAsk;
    allowlist: string[];
  };
  mcp: {
    enabled: boolean;
    binary: string;
    configPath?: string;
    defaultTimeoutMs: number;
    maxOutputChars: number;
    allowHttp: boolean;
    allowStdio: boolean;
  };
  research: {
    enabled: boolean;
    provider: "tavily";
    apiKey?: string;
    defaultMaxResults: number;
    maxResultsLimit: number;
    timeoutMs: number;
    fetchMaxChars: number;
    fetchCacheTtlMs: number;
    fetchMaxRedirects: number;
    fetchMaxResponseBytes: number;
  };
  media: {
    enabled: boolean;
    provider: "openai";
    apiKey?: string;
    baseUrl: string;
    timeoutMs: number;
    imageGenerationTimeoutMs: number;
    maxAttachmentBytes: number;
    maxTotalBytesPerMessage: number;
    maxProcessingMsPerMessage: number;
    maxAttachmentsPerMessage: number;
    maxAttachmentsBySource: {
      api: number;
      discord: number;
      email: number;
      unknown: number;
    };
    imageModel: string;
    imagePrompt: string;
    audioModel: string;
  };
  browser: {
    enabled: boolean;
    headless: boolean;
    defaultTimeoutMs: number;
    actionTimeoutMs: number;
    maxScreenshotsPerTurn: number;
    sessionTtlMs: number;
    maxSessions: number;
    artifactDir: string;
  };
  email: {
    enabled: boolean;
    pollIntervalMs: number;
    provider: "gmail_pop3";
    autoReplyEnabled: boolean;
    gmail: {
      address: string;
      appPassword: string;
      host: string;
      port: number;
      timeoutMs: number;
      topLines: number;
      maxMessagesPerPoll: number;
      smtpHost: string;
      smtpPort: number;
      smtpTimeoutMs: number;
    };
  };
  pi: PiEngineConfig;
};

export class ConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid Kael configuration: ${issues.join("; ")}`);
    this.name = "ConfigValidationError";
  }
}

const DEFAULT_KAEL_SYSTEM_PROMPT =
  "Voce e Kael, super agente local de video e automacao. Seja direto, tecnico e util. Quando o usuario pedir uma acao operacional (executar comando, abrir app, tocar video, checar sistema), use tools (exec/process) para agir de fato antes de responder; nao devolva apenas comando textual. Quando perguntarem sobre o proprio Kael (arquitetura, stack, frameworks, arquivos), confirme usando workspace_search/workspace_read antes de responder.";

export async function loadSoulPromptWithDeps(
  readFile: (path: string) => Promise<string>,
  cwd: string,
  explicitPath: string | undefined = process.env.KAEL_SOUL_PATH?.trim(),
): Promise<{ prompt: string; source?: string }> {
  const candidates = [
    explicitPath ? expandHome(explicitPath) : null,
    path.join(cwd, "docs/core/SOUL.md"),
    path.join(cwd, "SOUL.md"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate);
      const soul = raw.trim();
      if (!soul) {
        continue;
      }

      return {
        prompt: [
          DEFAULT_KAEL_SYSTEM_PROMPT,
          "A identidade do Kael e definida pelo arquivo SOUL.md abaixo. Siga essas diretrizes de forma consistente:",
          soul,
        ].join("\n\n"),
        source: candidate,
      };
    } catch {
      // continua tentando os proximos candidatos
    }
  }

  return { prompt: DEFAULT_KAEL_SYSTEM_PROMPT };
}

async function loadSoulPrompt(cwd: string): Promise<{ prompt: string; source?: string }> {
  return loadSoulPromptWithDeps((path) => fs.readFile(path, "utf-8"), cwd);
}

function parseEngineMode(raw: string | undefined): EngineMode {
  const value = raw?.trim().toLowerCase();
  if (!value) {
    return "simple";
  }
  if (value === "pi" || value === "hybrid") {
    return value;
  }
  if (value === "simple") {
    return value;
  }
  throw new ConfigValidationError([
    `KAEL_ENGINE_MODE inválido: "${raw}". Valores aceitos: simple, pi, hybrid`,
  ]);
}

type TimeoutPolicy = {
  piTurnMs: number;
  researchMs: number;
  mediaMs: number;
  imageGenerationMs: number;
  emailPop3Ms: number;
  emailSmtpMs: number;
};

function readPositiveTimeoutMs(raw: string | undefined, fallbackMs: number): number {
  const parsed = Number(raw ?? "");
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return Math.floor(fallbackMs);
}

function resolveTimeoutPolicy(params: {
  env: NodeJS.ProcessEnv;
  globalConfig: Awaited<ReturnType<typeof loadGlobalConfig>>;
}): TimeoutPolicy {
  const defaultPiTurnMs = params.globalConfig?.defaults.pi.timeoutMs ?? 45_000;
  const piTurnMs = readPositiveTimeoutMs(params.env.KAEL_PI_TIMEOUT_MS, defaultPiTurnMs);

  const defaultResearchMs = params.globalConfig?.defaults.research?.timeoutMs ?? 12_000;
  const researchMs = readPositiveTimeoutMs(params.env.KAEL_RESEARCH_TIMEOUT_MS, defaultResearchMs);

  const mediaMs = readPositiveTimeoutMs(params.env.KAEL_MEDIA_TIMEOUT_MS, 20_000);
  const imageGenerationMs = readPositiveTimeoutMs(
    params.env.KAEL_IMAGE_GENERATION_TIMEOUT_MS,
    mediaMs,
  );

  const emailPop3Ms = readPositiveTimeoutMs(params.env.KAEL_EMAIL_GMAIL_TIMEOUT_MS, 15_000);
  const emailSmtpMs = readPositiveTimeoutMs(params.env.KAEL_EMAIL_GMAIL_SMTP_TIMEOUT_MS, 15_000);

  return {
    piTurnMs,
    researchMs,
    mediaMs,
    imageGenerationMs,
    emailPop3Ms,
    emailSmtpMs,
  };
}

function validateConfig(config: KaelConfig): void {
  const issues: string[] = [];

  if ((config.engineMode === "pi" || config.engineMode === "hybrid") && !config.pi.apiKey) {
    issues.push("KAEL_PI_API_KEY é obrigatório quando KAEL_ENGINE_MODE=pi|hybrid");
  }

  if (!config.host.trim()) {
    issues.push("KAEL_HOST não pode ser vazio");
  }

  if (!Number.isFinite(config.port) || config.port <= 0) {
    issues.push("KAEL_PORT deve ser um número positivo");
  }

  if (!Number.isFinite(config.automation.schedulerTickMs) || config.automation.schedulerTickMs <= 0) {
    issues.push("KAEL_SCHEDULER_TICK_MS deve ser um número positivo");
  }

  if (!Number.isFinite(config.automation.heartbeatIntervalMs) || config.automation.heartbeatIntervalMs <= 0) {
    issues.push("KAEL_HEARTBEAT_INTERVAL_MS deve ser um número positivo");
  }

  if (
    !Number.isFinite(config.automation.plannerReconcileIntervalMs) ||
    config.automation.plannerReconcileIntervalMs <= 0
  ) {
    issues.push("KAEL_PLANNER_RECONCILE_INTERVAL_MS deve ser um número positivo");
  }

  if (config.execution.safePathsEnabled && config.execution.allowedPaths.length === 0) {
    issues.push("KAEL_ALLOWED_PATHS deve conter ao menos 1 caminho quando safe paths estiver habilitado");
  }

  if (!Number.isFinite(config.execution.maxJobArgs) || config.execution.maxJobArgs <= 0) {
    issues.push("KAEL_MAX_JOB_ARGS deve ser um número positivo");
  }

  if (!Number.isFinite(config.execution.maxConcurrentJobs) || config.execution.maxConcurrentJobs <= 0) {
    issues.push("KAEL_MAX_CONCURRENT_JOBS deve ser um número positivo");
  }

  if (!Number.isFinite(config.execution.jobTimeoutMs) || config.execution.jobTimeoutMs <= 0) {
    issues.push("KAEL_JOB_TIMEOUT_MS deve ser um número positivo");
  }

  if (!Number.isFinite(config.execution.killGraceMs) || config.execution.killGraceMs < 0) {
    issues.push("KAEL_JOB_KILL_GRACE_MS deve ser zero ou positivo");
  }

  if (!Number.isFinite(config.shell.defaultTimeoutMs) || config.shell.defaultTimeoutMs <= 0) {
    issues.push("KAEL_EXEC_TIMEOUT_MS deve ser um número positivo");
  }

  if (!Number.isFinite(config.shell.maxTimeoutMs) || config.shell.maxTimeoutMs <= 0) {
    issues.push("KAEL_EXEC_MAX_TIMEOUT_MS deve ser um número positivo");
  }

  if (!Number.isFinite(config.shell.maxOutputChars) || config.shell.maxOutputChars <= 0) {
    issues.push("KAEL_EXEC_MAX_OUTPUT_CHARS deve ser um número positivo");
  }

  if (!Number.isFinite(config.shell.noOutputTimeoutMs) || config.shell.noOutputTimeoutMs <= 0) {
    issues.push("KAEL_EXEC_NO_OUTPUT_TIMEOUT_MS deve ser um número positivo");
  }

  if (!Number.isFinite(config.shell.approvalWaitMs) || config.shell.approvalWaitMs <= 0) {
    issues.push("KAEL_EXEC_APPROVAL_WAIT_MS deve ser um número positivo");
  }

  if (!config.shell.workspaceRoot.trim()) {
    issues.push("KAEL_EXEC_WORKSPACE_ROOT nao pode ser vazio");
  }

  if (config.mcp.enabled) {
    if (!config.mcp.binary.trim()) {
      issues.push("KAEL_MCP_BINARY nao pode ser vazio quando KAEL_MCP_ENABLED=true");
    }
    if (!Number.isFinite(config.mcp.defaultTimeoutMs) || config.mcp.defaultTimeoutMs <= 0) {
      issues.push("KAEL_MCP_TIMEOUT_MS deve ser um numero positivo");
    }
    if (!Number.isFinite(config.mcp.maxOutputChars) || config.mcp.maxOutputChars <= 0) {
      issues.push("KAEL_MCP_MAX_OUTPUT_CHARS deve ser um numero positivo");
    }
  }

  if (config.research.enabled && !config.research.apiKey) {
    issues.push("KAEL_RESEARCH_API_KEY e obrigatorio quando KAEL_RESEARCH_ENABLED=true");
  }

  if (config.media.enabled) {
    if (config.media.provider === "openai" && !config.media.apiKey?.trim()) {
      issues.push("KAEL_MEDIA_OPENAI_API_KEY (ou KAEL_PI_API_KEY) e obrigatorio quando KAEL_MEDIA_ENABLED=true");
    }
    if (!config.media.baseUrl.trim()) {
      issues.push("KAEL_MEDIA_BASE_URL nao pode ser vazio");
    }
    if (!Number.isFinite(config.media.timeoutMs) || config.media.timeoutMs <= 0) {
      issues.push("KAEL_MEDIA_TIMEOUT_MS deve ser um numero positivo");
    }
    if (
      !Number.isFinite(config.media.imageGenerationTimeoutMs) ||
      config.media.imageGenerationTimeoutMs <= 0
    ) {
      issues.push("KAEL_IMAGE_GENERATION_TIMEOUT_MS deve ser um numero positivo");
    }
    if (!Number.isFinite(config.media.maxAttachmentBytes) || config.media.maxAttachmentBytes <= 0) {
      issues.push("KAEL_MEDIA_MAX_ATTACHMENT_BYTES deve ser um numero positivo");
    }
    if (
      !Number.isFinite(config.media.maxTotalBytesPerMessage) ||
      config.media.maxTotalBytesPerMessage <= 0
    ) {
      issues.push("KAEL_MEDIA_MAX_TOTAL_BYTES_PER_MESSAGE deve ser um numero positivo");
    }
    if (
      !Number.isFinite(config.media.maxProcessingMsPerMessage) ||
      config.media.maxProcessingMsPerMessage <= 0
    ) {
      issues.push("KAEL_MEDIA_MAX_PROCESSING_MS_PER_MESSAGE deve ser um numero positivo");
    }
    if (!Number.isFinite(config.media.maxAttachmentsPerMessage) || config.media.maxAttachmentsPerMessage <= 0) {
      issues.push("KAEL_MEDIA_MAX_ATTACHMENTS_PER_MESSAGE deve ser um numero positivo");
    }
  }

  if (config.browser.enabled) {
    if (!Number.isFinite(config.browser.defaultTimeoutMs) || config.browser.defaultTimeoutMs <= 0) {
      issues.push("KAEL_BROWSER_DEFAULT_TIMEOUT_MS deve ser um numero positivo");
    }
    if (!Number.isFinite(config.browser.actionTimeoutMs) || config.browser.actionTimeoutMs <= 0) {
      issues.push("KAEL_BROWSER_ACTION_TIMEOUT_MS deve ser um numero positivo");
    }
    if (!Number.isFinite(config.browser.maxScreenshotsPerTurn) || config.browser.maxScreenshotsPerTurn <= 0) {
      issues.push("KAEL_BROWSER_MAX_SCREENSHOTS_PER_TURN deve ser um numero positivo");
    }
    if (!Number.isFinite(config.browser.sessionTtlMs) || config.browser.sessionTtlMs <= 0) {
      issues.push("KAEL_BROWSER_SESSION_TTL_MS deve ser um numero positivo");
    }
    if (!Number.isFinite(config.browser.maxSessions) || config.browser.maxSessions <= 0) {
      issues.push("KAEL_BROWSER_MAX_SESSIONS deve ser um numero positivo");
    }
    if (!config.browser.artifactDir.trim()) {
      issues.push("KAEL_BROWSER_ARTIFACT_DIR nao pode ser vazio");
    }
  }

  if (!Number.isFinite(config.research.defaultMaxResults) || config.research.defaultMaxResults <= 0) {
    issues.push("KAEL_RESEARCH_MAX_RESULTS deve ser um numero positivo");
  }

  if (!Number.isFinite(config.research.maxResultsLimit) || config.research.maxResultsLimit <= 0) {
    issues.push("KAEL_RESEARCH_MAX_RESULTS_LIMIT deve ser um numero positivo");
  }

  if (!Number.isFinite(config.research.timeoutMs) || config.research.timeoutMs <= 0) {
    issues.push("KAEL_RESEARCH_TIMEOUT_MS deve ser um numero positivo");
  }

  if (!Number.isFinite(config.research.fetchMaxChars) || config.research.fetchMaxChars <= 0) {
    issues.push("KAEL_RESEARCH_FETCH_MAX_CHARS deve ser um numero positivo");
  }

  if (!Number.isFinite(config.research.fetchCacheTtlMs) || config.research.fetchCacheTtlMs < 0) {
    issues.push("KAEL_RESEARCH_FETCH_CACHE_TTL_MS deve ser zero ou positivo");
  }

  if (!Number.isFinite(config.research.fetchMaxRedirects) || config.research.fetchMaxRedirects < 0) {
    issues.push("KAEL_RESEARCH_FETCH_MAX_REDIRECTS deve ser zero ou positivo");
  }

  if (!Number.isFinite(config.research.fetchMaxResponseBytes) || config.research.fetchMaxResponseBytes <= 0) {
    issues.push("KAEL_RESEARCH_FETCH_MAX_RESPONSE_BYTES deve ser um numero positivo");
  }

  if (!Number.isFinite(config.email.pollIntervalMs) || config.email.pollIntervalMs <= 0) {
    issues.push("KAEL_EMAIL_POLL_INTERVAL_MS deve ser um numero positivo");
  }

  if (config.email.enabled) {
    if (!config.email.gmail.address.trim()) {
      issues.push("KAEL_EMAIL_GMAIL_ADDRESS e obrigatorio quando KAEL_EMAIL_ENABLED=true");
    }
    if (!config.email.gmail.appPassword.trim()) {
      issues.push("KAEL_EMAIL_GMAIL_APP_PASSWORD e obrigatorio quando KAEL_EMAIL_ENABLED=true");
    }
    if (!config.email.gmail.host.trim()) {
      issues.push("KAEL_EMAIL_GMAIL_HOST nao pode ser vazio");
    }
    if (!Number.isFinite(config.email.gmail.port) || config.email.gmail.port <= 0) {
      issues.push("KAEL_EMAIL_GMAIL_PORT deve ser um numero positivo");
    }
    if (!config.email.gmail.smtpHost.trim()) {
      issues.push("KAEL_EMAIL_GMAIL_SMTP_HOST nao pode ser vazio");
    }
    if (!Number.isFinite(config.email.gmail.smtpPort) || config.email.gmail.smtpPort <= 0) {
      issues.push("KAEL_EMAIL_GMAIL_SMTP_PORT deve ser um numero positivo");
    }
  }

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }
}

export async function loadConfig(cwd = process.cwd()): Promise<KaelConfig> {
  const globalConfig = await loadGlobalConfig();
  const soulPrompt = await loadSoulPrompt(cwd);
  const timeoutPolicy = resolveTimeoutPolicy({
    env: process.env,
    globalConfig,
  });

  const defaultPort = globalConfig?.defaults.port ?? 3210;
  const envPort = Number(process.env.KAEL_PORT ?? String(defaultPort));
  const port = Number.isFinite(envPort) && envPort > 0 ? envPort : defaultPort;

  const host =
    process.env.KAEL_HOST?.trim() || globalConfig?.defaults.host || "127.0.0.1";

  const globalDataDir = globalConfig?.defaults.dataDir
    ? expandHome(globalConfig.defaults.dataDir)
    : undefined;
  const dataDir =
    process.env.KAEL_DATA_DIR?.trim() || globalDataDir || path.join(cwd, ".kael-data");
  const apiAuthToken = process.env.KAEL_API_AUTH_TOKEN?.trim() || undefined;

  const engineMode = parseEngineMode(
    process.env.KAEL_ENGINE_MODE ?? globalConfig?.defaults.engineMode,
  );

  const defaultContextMessages = globalConfig?.defaults.context?.maxMessages ?? 24;
  const contextMessagesRaw = Number(
    process.env.KAEL_CONTEXT_MAX_MESSAGES ?? String(defaultContextMessages),
  );
  const maxContextMessages =
    Number.isFinite(contextMessagesRaw) && contextMessagesRaw > 0
      ? Math.floor(contextMessagesRaw)
      : defaultContextMessages;

  const defaultContextChars = globalConfig?.defaults.context?.maxChars ?? 12000;
  const contextCharsRaw = Number(
    process.env.KAEL_CONTEXT_MAX_CHARS ?? String(defaultContextChars),
  );
  const maxContextChars =
    Number.isFinite(contextCharsRaw) && contextCharsRaw > 0
      ? Math.floor(contextCharsRaw)
      : defaultContextChars;

  const idempotencyEnabledRaw =
    process.env.KAEL_IDEMPOTENCY_ENABLED?.trim() ??
    String(globalConfig?.defaults.idempotency?.enabled ?? true);
  const idempotencyEnabled = idempotencyEnabledRaw.toLowerCase() !== "false";
  const defaultIdempotencyTtlMs = globalConfig?.defaults.idempotency?.ttlMs ?? 10 * 60 * 1000;
  const idempotencyTtlRaw = Number(
    process.env.KAEL_IDEMPOTENCY_TTL_MS ?? String(defaultIdempotencyTtlMs),
  );
  const idempotencyTtlMs =
    Number.isFinite(idempotencyTtlRaw) && idempotencyTtlRaw > 0
      ? idempotencyTtlRaw
      : defaultIdempotencyTtlMs;

  const heartbeatEnabledRaw =
    process.env.KAEL_HEARTBEAT_ENABLED?.trim() ??
    String(globalConfig?.defaults.automation?.heartbeatEnabled ?? true);
  const heartbeatEnabled = heartbeatEnabledRaw.toLowerCase() !== "false";

  const defaultHeartbeatIntervalMs = globalConfig?.defaults.automation?.heartbeatIntervalMs ?? 30000;
  const heartbeatIntervalRaw = Number(
    process.env.KAEL_HEARTBEAT_INTERVAL_MS ?? String(defaultHeartbeatIntervalMs),
  );
  const heartbeatIntervalMs =
    Number.isFinite(heartbeatIntervalRaw) && heartbeatIntervalRaw > 0
      ? Math.floor(heartbeatIntervalRaw)
      : defaultHeartbeatIntervalMs;

  const defaultSchedulerTickMs = globalConfig?.defaults.automation?.schedulerTickMs ?? 1000;
  const schedulerTickRaw = Number(
    process.env.KAEL_SCHEDULER_TICK_MS ?? String(defaultSchedulerTickMs),
  );
  const schedulerTickMs =
    Number.isFinite(schedulerTickRaw) && schedulerTickRaw > 0
      ? Math.floor(schedulerTickRaw)
      : defaultSchedulerTickMs;

  const plannerReconcileEnabledRaw =
    process.env.KAEL_PLANNER_RECONCILE_ENABLED?.trim() ??
    String(globalConfig?.defaults.automation?.plannerReconcileEnabled ?? true);
  const plannerReconcileEnabled = plannerReconcileEnabledRaw.toLowerCase() !== "false";

  const defaultPlannerReconcileIntervalMs =
    globalConfig?.defaults.automation?.plannerReconcileIntervalMs ?? 30000;
  const plannerReconcileIntervalRaw = Number(
    process.env.KAEL_PLANNER_RECONCILE_INTERVAL_MS ?? String(defaultPlannerReconcileIntervalMs),
  );
  const plannerReconcileIntervalMs =
    Number.isFinite(plannerReconcileIntervalRaw) && plannerReconcileIntervalRaw > 0
      ? Math.floor(plannerReconcileIntervalRaw)
      : defaultPlannerReconcileIntervalMs;

  const safePathsEnabledRaw = process.env.KAEL_SAFE_PATHS_ENABLED?.trim() ?? "true";
  const safePathsEnabled = safePathsEnabledRaw.toLowerCase() !== "false";

  const allowedPathsRaw =
    process.env.KAEL_ALLOWED_PATHS?.trim() || [cwd, dataDir, "/tmp"].join(",");
  const allowedPaths = allowedPathsRaw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => expandHome(value));

  const maxJobArgsRaw = Number(process.env.KAEL_MAX_JOB_ARGS ?? "24");
  const maxJobArgs = Number.isFinite(maxJobArgsRaw) && maxJobArgsRaw > 0 ? Math.floor(maxJobArgsRaw) : 24;

  const maxConcurrentJobsRaw = Number(process.env.KAEL_MAX_CONCURRENT_JOBS ?? "2");
  const maxConcurrentJobs =
    Number.isFinite(maxConcurrentJobsRaw) && maxConcurrentJobsRaw > 0
      ? Math.floor(maxConcurrentJobsRaw)
      : 2;

  const jobTimeoutRaw = Number(process.env.KAEL_JOB_TIMEOUT_MS ?? String(60 * 60 * 1000));
  const jobTimeoutMs =
    Number.isFinite(jobTimeoutRaw) && jobTimeoutRaw > 0 ? Math.floor(jobTimeoutRaw) : 60 * 60 * 1000;

  const killGraceRaw = Number(process.env.KAEL_JOB_KILL_GRACE_MS ?? "3000");
  const killGraceMs = Number.isFinite(killGraceRaw) && killGraceRaw >= 0 ? Math.floor(killGraceRaw) : 3000;

  const defaultExecTimeoutMs = globalConfig?.defaults.shell?.defaultTimeoutMs ?? 60_000;
  const execTimeoutRaw = Number(process.env.KAEL_EXEC_TIMEOUT_MS ?? String(defaultExecTimeoutMs));
  const defaultTimeoutMs =
    Number.isFinite(execTimeoutRaw) && execTimeoutRaw > 0 ? Math.floor(execTimeoutRaw) : defaultExecTimeoutMs;

  const defaultExecMaxTimeoutMs = globalConfig?.defaults.shell?.maxTimeoutMs ?? 15 * 60_000;
  const execMaxTimeoutRaw = Number(
    process.env.KAEL_EXEC_MAX_TIMEOUT_MS ?? String(defaultExecMaxTimeoutMs),
  );
  const maxTimeoutMs =
    Number.isFinite(execMaxTimeoutRaw) && execMaxTimeoutRaw > 0
      ? Math.floor(execMaxTimeoutRaw)
      : defaultExecMaxTimeoutMs;

  const defaultExecMaxOutputChars = globalConfig?.defaults.shell?.maxOutputChars ?? 120_000;
  const execMaxOutputRaw = Number(
    process.env.KAEL_EXEC_MAX_OUTPUT_CHARS ?? String(defaultExecMaxOutputChars),
  );
  const maxOutputChars =
    Number.isFinite(execMaxOutputRaw) && execMaxOutputRaw > 0
      ? Math.floor(execMaxOutputRaw)
      : defaultExecMaxOutputChars;

  const defaultNoOutputTimeoutMs =
    (globalConfig?.defaults.shell as { noOutputTimeoutMs?: number } | undefined)?.noOutputTimeoutMs ??
    30_000;
  const noOutputTimeoutRaw = Number(
    process.env.KAEL_EXEC_NO_OUTPUT_TIMEOUT_MS ?? String(defaultNoOutputTimeoutMs),
  );
  const noOutputTimeoutMs =
    Number.isFinite(noOutputTimeoutRaw) && noOutputTimeoutRaw > 0
      ? Math.floor(noOutputTimeoutRaw)
      : defaultNoOutputTimeoutMs;

  const defaultExecApprovalWaitMs = globalConfig?.defaults.shell?.approvalWaitMs ?? 120_000;
  const execApprovalWaitRaw = Number(
    process.env.KAEL_EXEC_APPROVAL_WAIT_MS ?? String(defaultExecApprovalWaitMs),
  );
  const approvalWaitMs =
    Number.isFinite(execApprovalWaitRaw) && execApprovalWaitRaw > 0
      ? Math.floor(execApprovalWaitRaw)
      : defaultExecApprovalWaitMs;

  const defaultExecKillGraceMs =
    (globalConfig?.defaults.shell as { killGraceMs?: number } | undefined)?.killGraceMs ?? 3_000;
  const execKillGraceRaw = Number(
    process.env.KAEL_EXEC_KILL_GRACE_MS ?? String(defaultExecKillGraceMs),
  );
  const shellKillGraceMs =
    Number.isFinite(execKillGraceRaw) && execKillGraceRaw >= 0
      ? Math.floor(execKillGraceRaw)
      : defaultExecKillGraceMs;

  const defaultExecYieldMs =
    (globalConfig?.defaults.shell as { defaultYieldMs?: number } | undefined)?.defaultYieldMs ?? 0;
  const execYieldRaw = Number(process.env.KAEL_EXEC_YIELD_MS ?? String(defaultExecYieldMs));
  const shellDefaultYieldMs =
    Number.isFinite(execYieldRaw) && execYieldRaw >= 0
      ? Math.floor(execYieldRaw)
      : defaultExecYieldMs;

  const workspaceRoot = path.resolve(
    process.env.KAEL_EXEC_WORKSPACE_ROOT?.trim() || globalConfig?.defaults.shell?.workspaceRoot || cwd,
  );

  const securityRaw =
    process.env.KAEL_EXEC_SECURITY?.trim() || globalConfig?.defaults.shell?.security || "allowlist";
  const security: ExecSecurity =
    securityRaw === "deny" || securityRaw === "allowlist" || securityRaw === "full"
      ? securityRaw
      : "allowlist";

  const askRaw = process.env.KAEL_EXEC_ASK?.trim() || globalConfig?.defaults.shell?.ask || "on-miss";
  const ask: ExecAsk = askRaw === "off" || askRaw === "on-miss" || askRaw === "always" ? askRaw : "on-miss";

  const defaultAllowlist = globalConfig?.defaults.shell?.allowlist ?? [
    "ls",
    "cat",
    "pwd",
    "echo",
    "grep",
    "find",
    "curl",
    "ffmpeg",
    "ffprobe",
    "vlc",
  ];
  const allowlistRaw = process.env.KAEL_EXEC_ALLOWLIST?.trim() || defaultAllowlist.join(",");
  const allowlist = allowlistRaw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  const mcpEnabledRaw = process.env.KAEL_MCP_ENABLED?.trim() ?? "false";
  const mcpEnabled = mcpEnabledRaw.toLowerCase() === "true";
  const mcpBinary = process.env.KAEL_MCP_BINARY?.trim() || "mcporter";
  const mcpConfigPathRaw = process.env.KAEL_MCP_CONFIG_PATH?.trim();
  const mcpConfigPath = mcpConfigPathRaw ? path.resolve(expandHome(mcpConfigPathRaw)) : undefined;
  const mcpTimeoutRaw = Number(process.env.KAEL_MCP_TIMEOUT_MS ?? "30000");
  const mcpDefaultTimeoutMs =
    Number.isFinite(mcpTimeoutRaw) && mcpTimeoutRaw > 0 ? Math.floor(mcpTimeoutRaw) : 30_000;
  const mcpMaxOutputRaw = Number(process.env.KAEL_MCP_MAX_OUTPUT_CHARS ?? "120000");
  const mcpMaxOutputChars =
    Number.isFinite(mcpMaxOutputRaw) && mcpMaxOutputRaw > 0 ? Math.floor(mcpMaxOutputRaw) : 120_000;
  const mcpAllowHttpRaw = process.env.KAEL_MCP_ALLOW_HTTP?.trim() ?? "false";
  const mcpAllowHttp = mcpAllowHttpRaw.toLowerCase() === "true";
  const mcpAllowStdioRaw = process.env.KAEL_MCP_ALLOW_STDIO?.trim() ?? "false";
  const mcpAllowStdio = mcpAllowStdioRaw.toLowerCase() === "true";

  const researchEnabledRaw =
    process.env.KAEL_RESEARCH_ENABLED?.trim() ??
    String(globalConfig?.defaults.research?.enabled ?? false);
  const researchEnabled = researchEnabledRaw.toLowerCase() === "true";
  const researchProviderRaw =
    process.env.KAEL_RESEARCH_PROVIDER?.trim().toLowerCase() ||
    globalConfig?.defaults.research?.provider ||
    "tavily";
  const researchProvider: "tavily" = "tavily";
  if (researchProviderRaw !== "tavily") {
    throw new ConfigValidationError([
      `KAEL_RESEARCH_PROVIDER invalido: "${researchProviderRaw}". Valores aceitos: tavily`,
    ]);
  }
  const researchMaxRaw = Number(
    process.env.KAEL_RESEARCH_MAX_RESULTS ?? String(globalConfig?.defaults.research?.maxResults ?? 5),
  );
  const researchMax = Number.isFinite(researchMaxRaw) && researchMaxRaw > 0 ? Math.floor(researchMaxRaw) : 5;
  const researchMaxLimitRaw = Number(
    process.env.KAEL_RESEARCH_MAX_RESULTS_LIMIT ??
      String(globalConfig?.defaults.research?.maxResultsLimit ?? 10),
  );
  const researchMaxLimit =
    Number.isFinite(researchMaxLimitRaw) && researchMaxLimitRaw > 0 ? Math.floor(researchMaxLimitRaw) : 10;
  const researchTimeoutMs = timeoutPolicy.researchMs;
  const researchFetchMaxCharsRaw = Number(
    process.env.KAEL_RESEARCH_FETCH_MAX_CHARS ??
      String(globalConfig?.defaults.research?.fetchMaxChars ?? 12000),
  );
  const researchFetchMaxChars =
    Number.isFinite(researchFetchMaxCharsRaw) && researchFetchMaxCharsRaw > 0
      ? Math.floor(researchFetchMaxCharsRaw)
      : 12000;
  const researchFetchCacheTtlRaw = Number(
    process.env.KAEL_RESEARCH_FETCH_CACHE_TTL_MS ??
      String(globalConfig?.defaults.research?.fetchCacheTtlMs ?? 10 * 60 * 1000),
  );
  const researchFetchCacheTtlMs =
    Number.isFinite(researchFetchCacheTtlRaw) && researchFetchCacheTtlRaw >= 0
      ? Math.floor(researchFetchCacheTtlRaw)
      : 10 * 60 * 1000;
  const researchFetchMaxRedirectsRaw = Number(
    process.env.KAEL_RESEARCH_FETCH_MAX_REDIRECTS ??
      String(globalConfig?.defaults.research?.fetchMaxRedirects ?? 3),
  );
  const researchFetchMaxRedirects =
    Number.isFinite(researchFetchMaxRedirectsRaw) && researchFetchMaxRedirectsRaw >= 0
      ? Math.floor(researchFetchMaxRedirectsRaw)
      : 3;
  const researchFetchMaxResponseBytesRaw = Number(
    process.env.KAEL_RESEARCH_FETCH_MAX_RESPONSE_BYTES ??
      String(globalConfig?.defaults.research?.fetchMaxResponseBytes ?? 2_000_000),
  );
  const researchFetchMaxResponseBytes =
    Number.isFinite(researchFetchMaxResponseBytesRaw) && researchFetchMaxResponseBytesRaw > 0
      ? Math.floor(researchFetchMaxResponseBytesRaw)
      : 2_000_000;
  const researchApiKey = process.env.KAEL_RESEARCH_API_KEY?.trim();

  const mediaEnabledRaw = process.env.KAEL_MEDIA_ENABLED?.trim() ?? "false";
  const mediaEnabled = mediaEnabledRaw.toLowerCase() === "true";
  const mediaProviderRaw = process.env.KAEL_MEDIA_PROVIDER?.trim().toLowerCase() || "openai";
  const mediaProvider: "openai" = "openai";
  if (mediaProviderRaw !== "openai") {
    throw new ConfigValidationError([
      `KAEL_MEDIA_PROVIDER invalido: "${mediaProviderRaw}". Valores aceitos: openai`,
    ]);
  }
  const mediaTimeoutMs = timeoutPolicy.mediaMs;
  const mediaImageGenerationTimeoutMs = timeoutPolicy.imageGenerationMs;
  const mediaMaxAttachmentBytesRaw = Number(process.env.KAEL_MEDIA_MAX_ATTACHMENT_BYTES ?? "8000000");
  const mediaMaxAttachmentBytes =
    Number.isFinite(mediaMaxAttachmentBytesRaw) && mediaMaxAttachmentBytesRaw > 0
      ? Math.floor(mediaMaxAttachmentBytesRaw)
      : 8_000_000;
  const mediaMaxAttachmentsRaw = Number(process.env.KAEL_MEDIA_MAX_ATTACHMENTS_PER_MESSAGE ?? "3");
  const mediaMaxAttachmentsPerMessage =
    Number.isFinite(mediaMaxAttachmentsRaw) && mediaMaxAttachmentsRaw > 0
      ? Math.floor(mediaMaxAttachmentsRaw)
      : 3;
  const mediaApiKey = process.env.KAEL_MEDIA_OPENAI_API_KEY?.trim() || process.env.KAEL_PI_API_KEY?.trim();
  const mediaBaseUrl = process.env.KAEL_MEDIA_BASE_URL?.trim() || "https://api.openai.com/v1";
  const mediaImageModel = process.env.KAEL_MEDIA_IMAGE_MODEL?.trim() || "gpt-4o-mini";
  const mediaImagePrompt =
    process.env.KAEL_MEDIA_IMAGE_PROMPT?.trim() ||
    "Voce e um extrator de contexto visual. Descreva de forma objetiva apenas o que ajuda a responder o pedido.";
  const mediaAudioModel = process.env.KAEL_MEDIA_AUDIO_MODEL?.trim() || "gpt-4o-mini-transcribe";
  const browserEnabledRaw = process.env.KAEL_BROWSER_ENABLED?.trim() ?? "false";
  const browserEnabled = browserEnabledRaw.toLowerCase() === "true";
  const browserHeadlessRaw = process.env.KAEL_BROWSER_HEADLESS?.trim() ?? "true";
  const browserHeadless = browserHeadlessRaw.toLowerCase() !== "false";
  const browserDefaultTimeoutRaw = Number(process.env.KAEL_BROWSER_DEFAULT_TIMEOUT_MS ?? "30000");
  const browserDefaultTimeoutMs =
    Number.isFinite(browserDefaultTimeoutRaw) && browserDefaultTimeoutRaw > 0
      ? Math.floor(browserDefaultTimeoutRaw)
      : 30_000;
  const browserActionTimeoutRaw = Number(process.env.KAEL_BROWSER_ACTION_TIMEOUT_MS ?? "12000");
  const browserActionTimeoutMs =
    Number.isFinite(browserActionTimeoutRaw) && browserActionTimeoutRaw > 0
      ? Math.floor(browserActionTimeoutRaw)
      : 12_000;
  const browserMaxScreenshotsRaw = Number(process.env.KAEL_BROWSER_MAX_SCREENSHOTS_PER_TURN ?? "3");
  const browserMaxScreenshotsPerTurn =
    Number.isFinite(browserMaxScreenshotsRaw) && browserMaxScreenshotsRaw > 0
      ? Math.floor(browserMaxScreenshotsRaw)
      : 3;
  const browserSessionTtlRaw = Number(process.env.KAEL_BROWSER_SESSION_TTL_MS ?? String(20 * 60 * 1000));
  const browserSessionTtlMs =
    Number.isFinite(browserSessionTtlRaw) && browserSessionTtlRaw > 0
      ? Math.floor(browserSessionTtlRaw)
      : 20 * 60 * 1000;
  const browserMaxSessionsRaw = Number(process.env.KAEL_BROWSER_MAX_SESSIONS ?? "4");
  const browserMaxSessions =
    Number.isFinite(browserMaxSessionsRaw) && browserMaxSessionsRaw > 0
      ? Math.floor(browserMaxSessionsRaw)
      : 4;
  const browserArtifactDir = path.resolve(
    process.env.KAEL_BROWSER_ARTIFACT_DIR?.trim() || path.join(dataDir, "browser", "artifacts"),
  );

  const emailEnabledRaw = process.env.KAEL_EMAIL_ENABLED?.trim() ?? "false";
  const emailEnabled = emailEnabledRaw.toLowerCase() === "true";
  const emailPollIntervalRaw = Number(process.env.KAEL_EMAIL_POLL_INTERVAL_MS ?? "60000");
  const emailPollIntervalMs =
    Number.isFinite(emailPollIntervalRaw) && emailPollIntervalRaw > 0
      ? Math.floor(emailPollIntervalRaw)
      : 60000;
  const emailProviderRaw = process.env.KAEL_EMAIL_PROVIDER?.trim().toLowerCase() || "gmail_pop3";
  const emailProvider: "gmail_pop3" = "gmail_pop3";
  if (emailProviderRaw !== "gmail_pop3") {
    throw new ConfigValidationError([
      `KAEL_EMAIL_PROVIDER invalido: "${emailProviderRaw}". Valores aceitos: gmail_pop3`,
    ]);
  }
  const emailGmailPortRaw = Number(process.env.KAEL_EMAIL_GMAIL_PORT ?? "995");
  const emailGmailPort =
    Number.isFinite(emailGmailPortRaw) && emailGmailPortRaw > 0 ? Math.floor(emailGmailPortRaw) : 995;
  const emailGmailTimeoutMs = timeoutPolicy.emailPop3Ms;
  const emailGmailTopLinesRaw = Number(process.env.KAEL_EMAIL_GMAIL_TOP_LINES ?? "40");
  const emailGmailTopLines =
    Number.isFinite(emailGmailTopLinesRaw) && emailGmailTopLinesRaw > 0
      ? Math.floor(emailGmailTopLinesRaw)
      : 40;
  const emailGmailMaxPerPollRaw = Number(process.env.KAEL_EMAIL_GMAIL_MAX_MESSAGES_PER_POLL ?? "10");
  const emailGmailMaxPerPoll =
    Number.isFinite(emailGmailMaxPerPollRaw) && emailGmailMaxPerPollRaw > 0
      ? Math.floor(emailGmailMaxPerPollRaw)
      : 10;
  const emailAutoReplyRaw = process.env.KAEL_EMAIL_AUTO_REPLY_ENABLED?.trim() ?? "false";
  const emailAutoReplyEnabled = emailAutoReplyRaw.toLowerCase() === "true";
  const emailSmtpPortRaw = Number(process.env.KAEL_EMAIL_GMAIL_SMTP_PORT ?? "465");
  const emailSmtpPort =
    Number.isFinite(emailSmtpPortRaw) && emailSmtpPortRaw > 0 ? Math.floor(emailSmtpPortRaw) : 465;
  const emailSmtpTimeoutMs = timeoutPolicy.emailSmtpMs;
  const timeoutMs = timeoutPolicy.piTurnMs;

  const provider =
    process.env.KAEL_PI_PROVIDER?.trim() || globalConfig?.defaults.pi.provider || "openai";

  const defaultRetryAttempts = globalConfig?.defaults.pi.retry?.attempts ?? 3;
  const retryAttemptsRaw = Number(
    process.env.KAEL_PI_RETRY_ATTEMPTS ?? String(defaultRetryAttempts),
  );
  const retryAttempts =
    Number.isFinite(retryAttemptsRaw) && retryAttemptsRaw > 0
      ? Math.floor(retryAttemptsRaw)
      : defaultRetryAttempts;

  const defaultRetryBaseDelayMs = globalConfig?.defaults.pi.retry?.baseDelayMs ?? 300;
  const retryBaseDelayRaw = Number(
    process.env.KAEL_PI_RETRY_BASE_MS ?? String(defaultRetryBaseDelayMs),
  );
  const retryBaseDelayMs =
    Number.isFinite(retryBaseDelayRaw) && retryBaseDelayRaw >= 0
      ? retryBaseDelayRaw
      : defaultRetryBaseDelayMs;

  const defaultRetryMaxDelayMs = globalConfig?.defaults.pi.retry?.maxDelayMs ?? 3000;
  const retryMaxDelayRaw = Number(
    process.env.KAEL_PI_RETRY_MAX_MS ?? String(defaultRetryMaxDelayMs),
  );
  const retryMaxDelayMs =
    Number.isFinite(retryMaxDelayRaw) && retryMaxDelayRaw >= 0
      ? retryMaxDelayRaw
      : defaultRetryMaxDelayMs;

  const defaultRetryJitterMs = globalConfig?.defaults.pi.retry?.jitterMs ?? 250;
  const retryJitterRaw = Number(
    process.env.KAEL_PI_RETRY_JITTER_MS ?? String(defaultRetryJitterMs),
  );
  const retryJitterMs =
    Number.isFinite(retryJitterRaw) && retryJitterRaw >= 0 ? retryJitterRaw : defaultRetryJitterMs;

  const apiKey = process.env.KAEL_PI_API_KEY?.trim();
  const pi: PiEngineConfig = {
    enabled: true,
    provider,
    systemPrompt: soulPrompt.prompt,
    systemPromptSource: soulPrompt.source,
    apiKey,
    model: process.env.KAEL_PI_MODEL?.trim() || globalConfig?.defaults.pi.model || "gpt-5.5",
    timeoutMs,
    retry: {
      attempts: retryAttempts,
      baseDelayMs: retryBaseDelayMs,
      maxDelayMs: retryMaxDelayMs,
      jitterMs: retryJitterMs,
    },
  };

  const config: KaelConfig = {
    port,
    host,
    dataDir,
    api: { authToken: apiAuthToken },
    engineMode,
    context: {
      maxMessages: maxContextMessages,
      maxChars: maxContextChars,
    },
    idempotency: { enabled: idempotencyEnabled, ttlMs: idempotencyTtlMs },
    automation: {
      heartbeatEnabled,
      heartbeatIntervalMs,
      plannerReconcileEnabled,
      plannerReconcileIntervalMs,
      schedulerTickMs,
    },
    execution: {
      safePathsEnabled,
      allowedPaths,
      maxJobArgs,
      maxConcurrentJobs,
      jobTimeoutMs,
      killGraceMs,
    },
    shell: {
      workspaceRoot,
      defaultTimeoutMs,
      noOutputTimeoutMs,
      maxTimeoutMs,
      maxOutputChars,
      approvalWaitMs,
      killGraceMs: shellKillGraceMs,
      defaultYieldMs: shellDefaultYieldMs,
      security,
      ask,
      allowlist,
    },
    mcp: {
      enabled: mcpEnabled,
      binary: mcpBinary,
      configPath: mcpConfigPath,
      defaultTimeoutMs: mcpDefaultTimeoutMs,
      maxOutputChars: mcpMaxOutputChars,
      allowHttp: mcpAllowHttp,
      allowStdio: mcpAllowStdio,
    },
    research: {
      enabled: researchEnabled,
      provider: researchProvider,
      apiKey: researchApiKey,
      defaultMaxResults: researchMax,
      maxResultsLimit: researchMaxLimit,
      timeoutMs: researchTimeoutMs,
      fetchMaxChars: researchFetchMaxChars,
      fetchCacheTtlMs: researchFetchCacheTtlMs,
      fetchMaxRedirects: researchFetchMaxRedirects,
      fetchMaxResponseBytes: researchFetchMaxResponseBytes,
    },
    media: {
      enabled: mediaEnabled,
      provider: mediaProvider,
      apiKey: mediaApiKey,
      baseUrl: mediaBaseUrl,
      timeoutMs: mediaTimeoutMs,
      imageGenerationTimeoutMs: mediaImageGenerationTimeoutMs,
      maxAttachmentBytes: mediaMaxAttachmentBytes,
      maxTotalBytesPerMessage: mediaMaxTotalBytesPerMessage,
      maxProcessingMsPerMessage: mediaMaxProcessingMsPerMessage,
      maxAttachmentsPerMessage: mediaMaxAttachmentsPerMessage,
      maxAttachmentsBySource: mediaMaxAttachmentsBySource,
      imageModel: mediaImageModel,
      imagePrompt: mediaImagePrompt,
      audioModel: mediaAudioModel,
    },
    browser: {
      enabled: browserEnabled,
      headless: browserHeadless,
      defaultTimeoutMs: browserDefaultTimeoutMs,
      actionTimeoutMs: browserActionTimeoutMs,
      maxScreenshotsPerTurn: browserMaxScreenshotsPerTurn,
      sessionTtlMs: browserSessionTtlMs,
      maxSessions: browserMaxSessions,
      artifactDir: browserArtifactDir,
    },
    email: {
      enabled: emailEnabled,
      pollIntervalMs: emailPollIntervalMs,
      provider: emailProvider,
      autoReplyEnabled: emailAutoReplyEnabled,
      gmail: {
        address: process.env.KAEL_EMAIL_GMAIL_ADDRESS?.trim() || "",
        appPassword: process.env.KAEL_EMAIL_GMAIL_APP_PASSWORD?.trim() || "",
        host: process.env.KAEL_EMAIL_GMAIL_HOST?.trim() || "pop.gmail.com",
        port: emailGmailPort,
        timeoutMs: emailGmailTimeoutMs,
        topLines: emailGmailTopLines,
        maxMessagesPerPoll: emailGmailMaxPerPoll,
        smtpHost: process.env.KAEL_EMAIL_GMAIL_SMTP_HOST?.trim() || "smtp.gmail.com",
        smtpPort: emailSmtpPort,
        smtpTimeoutMs: emailSmtpTimeoutMs,
      },
    },
    pi,
  };
  validateConfig(config);
  return config;
}
  const mediaMaxTotalBytesRaw = Number(process.env.KAEL_MEDIA_MAX_TOTAL_BYTES_PER_MESSAGE ?? "12000000");
  const mediaMaxTotalBytesPerMessage =
    Number.isFinite(mediaMaxTotalBytesRaw) && mediaMaxTotalBytesRaw > 0
      ? Math.floor(mediaMaxTotalBytesRaw)
      : 12_000_000;
  const mediaMaxProcessingMsRaw = Number(process.env.KAEL_MEDIA_MAX_PROCESSING_MS_PER_MESSAGE ?? "15000");
  const mediaMaxProcessingMsPerMessage =
    Number.isFinite(mediaMaxProcessingMsRaw) && mediaMaxProcessingMsRaw > 0
      ? Math.floor(mediaMaxProcessingMsRaw)
      : 15_000;
  const mediaMaxAttachmentsApiRaw = Number(process.env.KAEL_MEDIA_MAX_ATTACHMENTS_API ?? "3");
  const mediaMaxAttachmentsDiscordRaw = Number(process.env.KAEL_MEDIA_MAX_ATTACHMENTS_DISCORD ?? "2");
  const mediaMaxAttachmentsEmailRaw = Number(process.env.KAEL_MEDIA_MAX_ATTACHMENTS_EMAIL ?? "1");
  const mediaMaxAttachmentsUnknownRaw = Number(process.env.KAEL_MEDIA_MAX_ATTACHMENTS_UNKNOWN ?? "2");
  const mediaMaxAttachmentsBySource = {
    api:
      Number.isFinite(mediaMaxAttachmentsApiRaw) && mediaMaxAttachmentsApiRaw > 0
        ? Math.floor(mediaMaxAttachmentsApiRaw)
        : 3,
    discord:
      Number.isFinite(mediaMaxAttachmentsDiscordRaw) && mediaMaxAttachmentsDiscordRaw > 0
        ? Math.floor(mediaMaxAttachmentsDiscordRaw)
        : 2,
    email:
      Number.isFinite(mediaMaxAttachmentsEmailRaw) && mediaMaxAttachmentsEmailRaw > 0
        ? Math.floor(mediaMaxAttachmentsEmailRaw)
        : 1,
    unknown:
      Number.isFinite(mediaMaxAttachmentsUnknownRaw) && mediaMaxAttachmentsUnknownRaw > 0
        ? Math.floor(mediaMaxAttachmentsUnknownRaw)
        : 2,
  };
