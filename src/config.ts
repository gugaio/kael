import path from "node:path";
import fs from "node:fs/promises";
import { expandHome, loadGlobalConfig } from "./global-config.js";
import type { ExecAsk, ExecSecurity } from "./tools/system/shell-approvals.js";

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
    maxTimeoutMs: number;
    maxOutputChars: number;
    approvalWaitMs: number;
    security: ExecSecurity;
    ask: ExecAsk;
    allowlist: string[];
  };
  research: {
    enabled: boolean;
    provider: "tavily";
    apiKey?: string;
    defaultMaxResults: number;
    maxResultsLimit: number;
    timeoutMs: number;
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
  "Voce e Kael, super agente local de video e automacao. Seja direto, tecnico e util. Use comandos slash para acionar jobs locais quando for apropriado.";

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

  if (!Number.isFinite(config.shell.approvalWaitMs) || config.shell.approvalWaitMs <= 0) {
    issues.push("KAEL_EXEC_APPROVAL_WAIT_MS deve ser um número positivo");
  }

  if (!config.shell.workspaceRoot.trim()) {
    issues.push("KAEL_EXEC_WORKSPACE_ROOT nao pode ser vazio");
  }

  if (config.research.enabled && !config.research.apiKey) {
    issues.push("KAEL_RESEARCH_API_KEY e obrigatorio quando KAEL_RESEARCH_ENABLED=true");
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

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }
}

export async function loadConfig(cwd = process.cwd()): Promise<KaelConfig> {
  const globalConfig = await loadGlobalConfig();
  const soulPrompt = await loadSoulPrompt(cwd);

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
    globalConfig?.defaults.automation?.plannerReconcileIntervalMs ?? 5000;
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

  const defaultExecApprovalWaitMs = globalConfig?.defaults.shell?.approvalWaitMs ?? 120_000;
  const execApprovalWaitRaw = Number(
    process.env.KAEL_EXEC_APPROVAL_WAIT_MS ?? String(defaultExecApprovalWaitMs),
  );
  const approvalWaitMs =
    Number.isFinite(execApprovalWaitRaw) && execApprovalWaitRaw > 0
      ? Math.floor(execApprovalWaitRaw)
      : defaultExecApprovalWaitMs;

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
  const researchTimeoutRaw = Number(
    process.env.KAEL_RESEARCH_TIMEOUT_MS ?? String(globalConfig?.defaults.research?.timeoutMs ?? 12000),
  );
  const researchTimeoutMs =
    Number.isFinite(researchTimeoutRaw) && researchTimeoutRaw > 0 ? Math.floor(researchTimeoutRaw) : 12000;
  const researchApiKey = process.env.KAEL_RESEARCH_API_KEY?.trim();

  const defaultTimeout = globalConfig?.defaults.pi.timeoutMs ?? 45000;
  const timeoutRaw = Number(process.env.KAEL_PI_TIMEOUT_MS ?? String(defaultTimeout));
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : defaultTimeout;

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
    model: process.env.KAEL_PI_MODEL?.trim() || globalConfig?.defaults.pi.model || "gpt-4o-mini",
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
      maxTimeoutMs,
      maxOutputChars,
      approvalWaitMs,
      security,
      ask,
      allowlist,
    },
    research: {
      enabled: researchEnabled,
      provider: researchProvider,
      apiKey: researchApiKey,
      defaultMaxResults: researchMax,
      maxResultsLimit: researchMaxLimit,
      timeoutMs: researchTimeoutMs,
    },
    pi,
  };
  validateConfig(config);
  return config;
}
