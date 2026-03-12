import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { ensureDir, readJsonFile, writeJsonFile } from "../../infra/fs.js";
import { kaelLogger } from "../../infra/logger.js";
import { LocalProcessRunner, type ProcessRunner } from "../system/process-runner.js";

export type McpServerTransport = "config" | "http" | "stdio";
export type McpApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type McpRegistryEntry = {
  name: string;
  transport: McpServerTransport;
  target: string;
  enabled: boolean;
  requireApproval: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type McpApprovalEntry = {
  id: string;
  serverName: string;
  transport: McpServerTransport;
  target: string;
  createdAt: string;
  expiresAt: string;
  status: McpApprovalStatus;
  decidedAt?: string;
};

type McpRegistryFile = {
  version: 1;
  servers: McpRegistryEntry[];
  updatedAt: string;
};

type McpApprovalsFile = {
  version: 1;
  entries: McpApprovalEntry[];
  updatedAt: string;
};

type McpBridgeConfig = {
  enabled: boolean;
  binary: string;
  configPath?: string;
  registryPath: string;
  approvalsPath: string;
  workspaceRoot: string;
  defaultTimeoutMs: number;
  maxOutputChars: number;
  allowHttp: boolean;
  allowStdio: boolean;
  approvalTtlMs?: number;
};

type McpListParams = {
  sessionKey: string;
  server?: string;
  schema?: boolean;
  timeoutMs?: number;
};

type McpCallParams = {
  sessionKey: string;
  target: string;
  argumentsJson?: string;
  stdioCommand?: string;
  timeoutMs?: number;
};

export type McpListResult = {
  ok: boolean;
  command: string;
  server?: string;
  schema: boolean;
  format: "json";
  items?: unknown;
  output?: string;
  error?: string;
};

export type McpCallResult = {
  ok: boolean;
  command: string;
  target: string;
  format: "json";
  output?: unknown;
  rawOutput?: string;
  error?: string;
};

export type McpRuntimeTelemetry = {
  enabled: boolean;
  configuredServers: number;
  enabledServers: number;
  totalCalls: number;
  listCalls: number;
  callCalls: number;
  blockedCalls: number;
  failedCalls: number;
  approvalPending: number;
  approvalsOpen: number;
  serversByTransport: Record<McpServerTransport, number>;
  lastError: string | null;
  lastCallAt: string | null;
};

export interface McpRuntime {
  init(): Promise<void>;
  list(params: McpListParams): Promise<McpListResult>;
  call(params: McpCallParams): Promise<McpCallResult>;
  listServers(): Promise<McpRegistryEntry[]>;
  getServer(name: string): Promise<McpRegistryEntry | null>;
  upsertServer(entry: {
    name: string;
    transport: McpServerTransport;
    target: string;
    enabled?: boolean;
    requireApproval?: boolean;
    description?: string;
  }): Promise<McpRegistryEntry>;
  listApprovals(params?: {
    status?: McpApprovalStatus | "open";
    limit?: number;
  }): Promise<McpApprovalEntry[]>;
  resolveApproval(approvalId: string, decision: "approved" | "denied"): Promise<McpApprovalEntry | null>;
  getRuntimeTelemetrySnapshot(): McpRuntimeTelemetry;
}

type CommandRunResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};

type ResolvedServerCall =
  | {
      ok: true;
      entry: McpRegistryEntry;
      selector: string;
      toolName?: string;
      approval?: { allowed: true } | { allowed: false; entry: McpApprovalEntry; reason: string };
    }
  | {
      ok: false;
      error: string;
    };

const MAX_APPROVAL_HISTORY = 300;
const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;

function appendWithCap(current: string, chunk: string, maxChars: number): string {
  if (!chunk) {
    return current;
  }
  const next = current + chunk;
  if (next.length <= maxChars) {
    return next;
  }
  return next.slice(next.length - maxChars);
}

function parseJsonSafely(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return JSON.parse(trimmed);
}

function normalizeName(raw: string): string {
  return raw.trim().toLowerCase();
}

function defaultRegistryFile(): McpRegistryFile {
  return {
    version: 1,
    servers: [],
    updatedAt: new Date().toISOString(),
  };
}

function defaultApprovalsFile(): McpApprovalsFile {
  return {
    version: 1,
    entries: [],
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeRegistryFile(raw: unknown): McpRegistryFile {
  const fallback = defaultRegistryFile();
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const typed = raw as Partial<McpRegistryFile>;
  const servers = Array.isArray(typed.servers)
    ? typed.servers.filter((item): item is McpRegistryEntry => {
        if (!item || typeof item !== "object") {
          return false;
        }
        const candidate = item as Partial<McpRegistryEntry>;
        return (
          typeof candidate.name === "string" &&
          (candidate.transport === "config" || candidate.transport === "http" || candidate.transport === "stdio") &&
          typeof candidate.target === "string" &&
          typeof candidate.enabled === "boolean" &&
          typeof candidate.requireApproval === "boolean" &&
          typeof candidate.createdAt === "string" &&
          typeof candidate.updatedAt === "string" &&
          (candidate.description === undefined || typeof candidate.description === "string")
        );
      })
    : [];
  return {
    version: 1,
    servers,
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeApprovalsFile(raw: unknown): McpApprovalsFile {
  const fallback = defaultApprovalsFile();
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const typed = raw as Partial<McpApprovalsFile>;
  const now = Date.now();
  const entries = Array.isArray(typed.entries)
    ? typed.entries
        .filter((item): item is McpApprovalEntry => {
          if (!item || typeof item !== "object") {
            return false;
          }
          const candidate = item as Partial<McpApprovalEntry>;
          return (
            typeof candidate.id === "string" &&
            typeof candidate.serverName === "string" &&
            (candidate.transport === "config" || candidate.transport === "http" || candidate.transport === "stdio") &&
            typeof candidate.target === "string" &&
            typeof candidate.createdAt === "string" &&
            typeof candidate.expiresAt === "string" &&
            (candidate.status === "pending" ||
              candidate.status === "approved" ||
              candidate.status === "denied" ||
              candidate.status === "expired") &&
            (candidate.decidedAt === undefined || typeof candidate.decidedAt === "string")
          );
        })
        .map((entry) => {
          if (entry.status === "pending" && Date.parse(entry.expiresAt) <= now) {
            return {
              ...entry,
              status: "expired" as const,
              decidedAt: new Date(now).toISOString(),
            };
          }
          return entry;
        })
        .slice(-MAX_APPROVAL_HISTORY)
    : [];
  return {
    version: 1,
    entries,
    updatedAt: new Date().toISOString(),
  };
}

function splitTarget(raw: string): { serverName: string; toolName: string } | null {
  const trimmed = raw.trim();
  const separator = trimmed.indexOf(".");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return null;
  }
  return {
    serverName: normalizeName(trimmed.slice(0, separator)),
    toolName: trimmed.slice(separator + 1).trim(),
  };
}

export class McpBridgeService implements McpRuntime {
  private readonly runner: ProcessRunner;
  private readonly approvalTtlMs: number;
  private readonly telemetry: McpRuntimeTelemetry = {
    enabled: false,
    configuredServers: 0,
    enabledServers: 0,
    totalCalls: 0,
    listCalls: 0,
    callCalls: 0,
    blockedCalls: 0,
    failedCalls: 0,
    approvalPending: 0,
    approvalsOpen: 0,
    serversByTransport: {
      config: 0,
      http: 0,
      stdio: 0,
    },
    lastError: null,
    lastCallAt: null,
  };

  constructor(
    private readonly cfg: McpBridgeConfig,
    runner?: ProcessRunner,
  ) {
    this.runner = runner ?? new LocalProcessRunner();
    this.approvalTtlMs = Math.max(1_000, Math.floor(cfg.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS));
    this.telemetry.enabled = cfg.enabled;
  }

  async init(): Promise<void> {
    await ensureDir(this.cfg.workspaceRoot);
    await writeJsonFile(
      this.cfg.registryPath,
      sanitizeRegistryFile(await readJsonFile(this.cfg.registryPath, defaultRegistryFile())),
    );
    await writeJsonFile(
      this.cfg.approvalsPath,
      sanitizeApprovalsFile(
        await readJsonFile(this.cfg.approvalsPath, defaultApprovalsFile()),
      ),
    );
    await this.refreshTelemetryCounts();
  }

  async list(params: McpListParams): Promise<McpListResult> {
    this.telemetry.totalCalls += 1;
    this.telemetry.listCalls += 1;
    this.telemetry.lastCallAt = new Date().toISOString();

    if (!this.cfg.enabled) {
      return this.failList(params, "mcp_disabled");
    }

    if (!params.server?.trim()) {
      const servers = await this.listServers();
      return {
        ok: true,
        command: "",
        schema: Boolean(params.schema),
        format: "json",
        items: servers,
      };
    }

    const resolved = await this.resolveRegisteredServer({
      selector: normalizeName(params.server),
      toolRequired: false,
    });
    if (!resolved.ok) {
      return this.failList(params, resolved.error);
    }
    if (resolved.approval && !resolved.approval.allowed) {
      this.telemetry.blockedCalls += 1;
      this.telemetry.approvalPending += 1;
      await this.refreshTelemetryCounts();
      return this.failList(
        params,
        `mcp_approval_required:${resolved.approval.entry.id}`,
        "",
        resolved.approval.reason,
      );
    }

    const args = ["list"];
    this.appendListArgs(args, resolved.entry);
    if (params.schema) {
      args.push("--schema");
    }
    args.push("--output", "json");

    const result = await this.runCommand(args, params.timeoutMs);
    if (!result.ok) {
      return this.failList(
        params,
        result.error || result.stderr.trim() || `mcporter exited with code ${result.exitCode ?? "unknown"}`,
        result.command,
        result.stdout.trim() || undefined,
      );
    }

    try {
      return {
        ok: true,
        command: result.command,
        server: resolved.entry.name,
        schema: Boolean(params.schema),
        format: "json",
        items: parseJsonSafely(result.stdout),
        output: result.stdout.trim() || undefined,
      };
    } catch (error) {
      return this.failList(
        params,
        `mcp_invalid_json: ${error instanceof Error ? error.message : String(error)}`,
        result.command,
        result.stdout.trim() || undefined,
      );
    }
  }

  async call(params: McpCallParams): Promise<McpCallResult> {
    this.telemetry.totalCalls += 1;
    this.telemetry.callCalls += 1;
    this.telemetry.lastCallAt = new Date().toISOString();

    if (!this.cfg.enabled) {
      return this.failCall(params, "mcp_disabled");
    }

    if (params.stdioCommand?.trim()) {
      return this.failCall(params, "mcp_stdio_command_inline_blocked_use_registry");
    }

    const parsed = splitTarget(params.target);
    if (!parsed) {
      return this.failCall(params, "mcp_target_must_be_server.tool");
    }

    if (params.argumentsJson?.trim()) {
      try {
        parseJsonSafely(params.argumentsJson);
      } catch (error) {
        return this.failCall(
          params,
          `mcp_args_invalid_json: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const resolved = await this.resolveRegisteredServer({
      selector: parsed.serverName,
      toolRequired: true,
      toolName: parsed.toolName,
    });
    if (!resolved.ok) {
      return this.failCall(params, resolved.error);
    }
    if (resolved.approval && !resolved.approval.allowed) {
      this.telemetry.blockedCalls += 1;
      this.telemetry.approvalPending += 1;
      await this.refreshTelemetryCounts();
      return this.failCall(params, `mcp_approval_required:${resolved.approval.entry.id}`);
    }

    const args = ["call"];
    this.appendCallArgs(args, resolved.entry, resolved.selector);
    if (params.argumentsJson?.trim()) {
      args.push("--args", params.argumentsJson.trim());
    }
    args.push("--output", "json");

    const result = await this.runCommand(args, params.timeoutMs);
    if (!result.ok) {
      return this.failCall(
        params,
        result.error || result.stderr.trim() || `mcporter exited with code ${result.exitCode ?? "unknown"}`,
        result.command,
        result.stdout.trim() || undefined,
      );
    }

    try {
      return {
        ok: true,
        command: result.command,
        target: params.target,
        format: "json",
        output: parseJsonSafely(result.stdout),
        rawOutput: result.stdout.trim() || undefined,
      };
    } catch (error) {
      return this.failCall(
        params,
        `mcp_invalid_json: ${error instanceof Error ? error.message : String(error)}`,
        result.command,
        result.stdout.trim() || undefined,
      );
    }
  }

  async listServers(): Promise<McpRegistryEntry[]> {
    const registry = await this.readRegistry();
    return [...registry.servers].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getServer(name: string): Promise<McpRegistryEntry | null> {
    const normalized = normalizeName(name);
    const registry = await this.readRegistry();
    return registry.servers.find((entry) => entry.name === normalized) ?? null;
  }

  async upsertServer(entry: {
    name: string;
    transport: McpServerTransport;
    target: string;
    enabled?: boolean;
    requireApproval?: boolean;
    description?: string;
  }): Promise<McpRegistryEntry> {
    const normalizedName = normalizeName(entry.name);
    const target = entry.target.trim();
    if (!normalizedName) {
      throw new Error("mcp server name required");
    }
    if (!target) {
      throw new Error("mcp server target required");
    }
    if (entry.transport === "http" && !this.cfg.allowHttp) {
      throw new Error("mcp_http_disabled_by_runtime");
    }
    if (entry.transport === "stdio" && !this.cfg.allowStdio) {
      throw new Error("mcp_stdio_disabled_by_runtime");
    }

    const registry = await this.readRegistry();
    const now = new Date().toISOString();
    const idx = registry.servers.findIndex((item) => item.name === normalizedName);
    const existing = idx >= 0 ? registry.servers[idx] : null;
    const next: McpRegistryEntry = {
      name: normalizedName,
      transport: entry.transport,
      target,
      enabled: entry.enabled ?? existing?.enabled ?? true,
      requireApproval:
        entry.requireApproval ??
        existing?.requireApproval ??
        (entry.transport === "config" ? false : true),
      description: entry.description?.trim() || existing?.description,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const servers = [...registry.servers];
    if (idx >= 0) {
      servers[idx] = next;
    } else {
      servers.push(next);
    }
    await writeJsonFile(this.cfg.registryPath, {
      version: 1,
      servers,
      updatedAt: now,
    } satisfies McpRegistryFile);
    await this.refreshTelemetryCounts();
    return next;
  }

  async listApprovals(params?: {
    status?: McpApprovalStatus | "open";
    limit?: number;
  }): Promise<McpApprovalEntry[]> {
    const approvals = await this.readApprovals();
    const limit = Number.isFinite(params?.limit) && (params?.limit ?? 0) > 0 ? Math.floor(params?.limit ?? 0) : 100;
    const filtered = approvals.entries.filter((entry) => {
      if (!params?.status) {
        return true;
      }
      if (params.status === "open") {
        return entry.status === "pending";
      }
      return entry.status === params.status;
    });
    return filtered
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  async resolveApproval(approvalId: string, decision: "approved" | "denied"): Promise<McpApprovalEntry | null> {
    const approvals = await this.readApprovals();
    const idx = approvals.entries.findIndex((entry) => entry.id === approvalId);
    if (idx < 0) {
      return null;
    }
    const current = approvals.entries[idx];
    if (current.status !== "pending") {
      return current;
    }
    const decided: McpApprovalEntry = {
      ...current,
      status: decision,
      decidedAt: new Date().toISOString(),
    };
    const entries = [...approvals.entries];
    entries[idx] = decided;
    await writeJsonFile(this.cfg.approvalsPath, {
      version: 1,
      entries: entries.slice(-MAX_APPROVAL_HISTORY),
      updatedAt: new Date().toISOString(),
    } satisfies McpApprovalsFile);
    await this.refreshTelemetryCounts();
    return decided;
  }

  getRuntimeTelemetrySnapshot(): McpRuntimeTelemetry {
    return {
      ...this.telemetry,
      serversByTransport: { ...this.telemetry.serversByTransport },
    };
  }

  private async resolveRegisteredServer(params: {
    selector: string;
    toolRequired: boolean;
    toolName?: string;
  }): Promise<ResolvedServerCall> {
    const entry = await this.getServer(params.selector);
    if (!entry) {
      return { ok: false, error: "mcp_server_unregistered" };
    }
    if (!entry.enabled) {
      return { ok: false, error: "mcp_server_disabled" };
    }
    if (entry.transport === "http" && !this.cfg.allowHttp) {
      return { ok: false, error: "mcp_http_disabled" };
    }
    if (entry.transport === "stdio" && !this.cfg.allowStdio) {
      return { ok: false, error: "mcp_stdio_disabled" };
    }
    let selector = entry.target;
    if (params.toolRequired) {
      if (!params.toolName?.trim()) {
        return { ok: false, error: "mcp_tool_required" };
      }
      selector =
        entry.transport === "config"
          ? `${entry.target}.${params.toolName.trim()}`
          : entry.transport === "http"
            ? `${entry.target}.${params.toolName.trim()}`
            : params.toolName.trim();
    }
    const approval = await this.evaluateApproval(entry);
    return {
      ok: true,
      entry,
      selector,
      ...(params.toolName ? { toolName: params.toolName } : {}),
      approval,
    };
  }

  private async evaluateApproval(
    entry: McpRegistryEntry,
  ): Promise<{ allowed: true } | { allowed: false; entry: McpApprovalEntry; reason: string } | undefined> {
    if (!entry.requireApproval) {
      return { allowed: true };
    }
    const approvals = await this.readApprovals();
    const matching = approvals.entries
      .filter(
        (item) =>
          item.serverName === entry.name && item.transport === entry.transport && item.target === entry.target,
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const latest = matching[0];
    if (latest?.status === "approved") {
      return { allowed: true };
    }
    if (latest?.status === "denied") {
      return { allowed: false, entry: latest, reason: "mcp_server_denied" };
    }
    if (latest?.status === "pending") {
      return {
        allowed: false,
        entry: latest,
        reason: `approval pending for MCP server ${entry.name} (${entry.transport})`,
      };
    }

    const pending: McpApprovalEntry = {
      id: randomUUID(),
      serverName: entry.name,
      transport: entry.transport,
      target: entry.target,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.approvalTtlMs).toISOString(),
      status: "pending",
    };
    await writeJsonFile(this.cfg.approvalsPath, {
      version: 1,
      entries: [...approvals.entries, pending].slice(-MAX_APPROVAL_HISTORY),
      updatedAt: new Date().toISOString(),
    } satisfies McpApprovalsFile);
    return {
      allowed: false,
      entry: pending,
      reason: `approval required for MCP server ${entry.name} (${entry.transport})`,
    };
  }

  private appendListArgs(args: string[], entry: McpRegistryEntry): void {
    if (entry.transport === "stdio") {
      args.push("--stdio", entry.target);
    }
    if (this.cfg.configPath) {
      args.push("--config", this.cfg.configPath);
    }
    if (entry.transport !== "stdio") {
      args.push(entry.target);
    }
  }

  private appendCallArgs(args: string[], entry: McpRegistryEntry, selector: string): void {
    if (entry.transport === "stdio") {
      args.push("--stdio", entry.target);
    }
    if (this.cfg.configPath) {
      args.push("--config", this.cfg.configPath);
    }
    args.push(selector);
  }

  private async runCommand(args: string[], timeoutMs?: number): Promise<CommandRunResult> {
    const startedAt = Date.now();
    const timeout = Math.max(1, Math.floor(timeoutMs ?? this.cfg.defaultTimeoutMs));
    const child = this.runner.spawn(this.cfg.binary, args, {
      cwd: this.cfg.workspaceRoot,
    }).process as ChildProcessWithoutNullStreams;
    const command = [this.cfg.binary, ...args].join(" ");

    return await new Promise<CommandRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const finish = (result: CommandRunResult) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        kaelLogger.info("mcp.bridge.command.finished", {
          command,
          ok: result.ok,
          exitCode: result.exitCode,
          timedOut,
          durationMs: Date.now() - startedAt,
        });
        resolve(result);
      };

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        finish({
          ok: false,
          command,
          stdout,
          stderr,
          exitCode: null,
          error: `mcp_timeout:${timeout}`,
        });
      }, timeout);

      child.stdout.on("data", (chunk) => {
        stdout = appendWithCap(stdout, String(chunk), this.cfg.maxOutputChars);
      });
      child.stderr.on("data", (chunk) => {
        stderr = appendWithCap(stderr, String(chunk), this.cfg.maxOutputChars);
      });
      child.on("error", (error) => {
        finish({
          ok: false,
          command,
          stdout,
          stderr,
          exitCode: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      child.on("close", (code) => {
        finish({
          ok: code === 0,
          command,
          stdout,
          stderr,
          exitCode: code,
        });
      });
    });
  }

  private async readRegistry(): Promise<McpRegistryFile> {
    return sanitizeRegistryFile(await readJsonFile(this.cfg.registryPath, defaultRegistryFile()));
  }

  private async readApprovals(): Promise<McpApprovalsFile> {
    return sanitizeApprovalsFile(
      await readJsonFile(this.cfg.approvalsPath, defaultApprovalsFile()),
    );
  }

  private async refreshTelemetryCounts(): Promise<void> {
    const registry = await this.readRegistry();
    const approvals = await this.readApprovals();
    this.telemetry.configuredServers = registry.servers.length;
    this.telemetry.enabledServers = registry.servers.filter((item) => item.enabled).length;
    this.telemetry.approvalsOpen = approvals.entries.filter((item) => item.status === "pending").length;
    this.telemetry.serversByTransport = {
      config: registry.servers.filter((item) => item.transport === "config").length,
      http: registry.servers.filter((item) => item.transport === "http").length,
      stdio: registry.servers.filter((item) => item.transport === "stdio").length,
    };
  }

  private failList(
    params: McpListParams,
    error: string,
    command = "",
    output?: string,
  ): McpListResult {
    this.telemetry.failedCalls += 1;
    this.telemetry.lastError = error;
    return {
      ok: false,
      command,
      server: params.server?.trim(),
      schema: Boolean(params.schema),
      format: "json",
      ...(output ? { output } : {}),
      error,
    };
  }

  private failCall(
    params: McpCallParams,
    error: string,
    command = "",
    rawOutput?: string,
  ): McpCallResult {
    this.telemetry.failedCalls += 1;
    this.telemetry.lastError = error;
    return {
      ok: false,
      command,
      target: params.target,
      format: "json",
      ...(rawOutput ? { rawOutput } : {}),
      error,
    };
  }
}
