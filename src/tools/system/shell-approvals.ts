import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type ExecSecurity = "deny" | "allowlist" | "full";
export type ExecAsk = "off" | "on-miss" | "always";
export type ExecApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type ExecApprovalEntry = {
  id: string;
  command: string;
  cwd: string;
  createdAt: string;
  expiresAt: string;
  status: ExecApprovalStatus;
  decidedAt?: string;
};

export type ExecApprovalsFile = {
  version: 1;
  security: ExecSecurity;
  ask: ExecAsk;
  allowlist: string[];
  // Legacy key name kept for compatibility; now stores pending + decided entries.
  pending: ExecApprovalEntry[];
  updatedAt: string;
};

export type ExecPolicy = {
  security: ExecSecurity;
  ask: ExecAsk;
  allowlist: Set<string>;
};

export type ExecPendingDecision = {
  status: "approval-pending" | "denied";
  approvalId?: string;
  reason: string;
};

export type ExecApprovalWaitResult = {
  status: "approved" | "denied" | "expired" | "timeout";
  reason: string;
};

export type ExecApprovalStoreDefaults = {
  security: ExecSecurity;
  ask: ExecAsk;
  allowlist: string[];
};

const DEFAULT_PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_APPROVAL_HISTORY = 300;
const UNSUPPORTED_ALLOWLIST_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /&&|\|\|/, reason: "operadores logicos (&&, ||) nao sao permitidos em allowlist" },
  { pattern: /[;<>()]/, reason: "encadeamento/subshell nao e permitido em allowlist" },
  { pattern: /(^|[^\\])`/, reason: "backticks nao sao permitidos em allowlist" },
  { pattern: /\$\(|\$\{/, reason: "substituicao de shell nao e permitida em allowlist" },
  { pattern: /(^|[^\\])[<>]/, reason: "redirecionamento nao e permitido em allowlist" },
  { pattern: /\r|\n/, reason: "multiline nao e permitido em allowlist" },
];

function normalizeAllowlist(allowlist: string[]): string[] {
  return Array.from(
    new Set(
      allowlist
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
    ),
  );
}

function defaultFile(defaults: ExecApprovalStoreDefaults): ExecApprovalsFile {
  return {
    version: 1,
    security: defaults.security,
    ask: defaults.ask,
    allowlist: normalizeAllowlist(defaults.allowlist),
    pending: [],
    updatedAt: new Date().toISOString(),
  };
}

function isExecSecurity(value: unknown): value is ExecSecurity {
  return value === "deny" || value === "allowlist" || value === "full";
}

function isExecAsk(value: unknown): value is ExecAsk {
  return value === "off" || value === "on-miss" || value === "always";
}

function isApprovalStatus(value: unknown): value is ExecApprovalStatus {
  return value === "pending" || value === "approved" || value === "denied" || value === "expired";
}

function normalizeApprovalEntries(raw: unknown): ExecApprovalEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is ExecApprovalEntry => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const candidate = item as Partial<ExecApprovalEntry>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.command === "string" &&
        typeof candidate.cwd === "string" &&
        typeof candidate.createdAt === "string" &&
        typeof candidate.expiresAt === "string" &&
        isApprovalStatus(candidate.status) &&
        (candidate.decidedAt === undefined || typeof candidate.decidedAt === "string")
      );
    })
    .slice(-MAX_APPROVAL_HISTORY);
}

function sanitizeFile(raw: unknown, defaults: ExecApprovalStoreDefaults): ExecApprovalsFile {
  if (!raw || typeof raw !== "object") {
    return defaultFile(defaults);
  }

  const typed = raw as Partial<ExecApprovalsFile>;
  const security = isExecSecurity(typed.security) ? typed.security : defaults.security;
  const ask = isExecAsk(typed.ask) ? typed.ask : defaults.ask;

  const now = Date.now();
  const entries = normalizeApprovalEntries(typed.pending).map((entry) => {
    if (entry.status === "pending" && Date.parse(entry.expiresAt) <= now) {
      return {
        ...entry,
        status: "expired" as const,
        decidedAt: new Date(now).toISOString(),
      };
    }
    return entry;
  });

  return {
    version: 1,
    security,
    ask,
    allowlist: normalizeAllowlist(Array.isArray(typed.allowlist) ? typed.allowlist : defaults.allowlist),
    pending: entries,
    updatedAt: new Date().toISOString(),
  };
}

export function extractCommandBins(command: string): string[] {
  const normalized = command.trim();
  if (!normalized) {
    return [];
  }

  const segments = normalized
    .split(/\|/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const bins: string[] = [];
  for (const segment of segments) {
    const firstToken = segment.split(/\s+/)[0]?.trim();
    if (!firstToken) {
      continue;
    }
    const base = path.basename(firstToken).toLowerCase();
    if (base) {
      bins.push(base);
    }
  }

  return Array.from(new Set(bins));
}

function analyzeAllowlistCommand(command: string): { ok: true; bins: string[] } | { ok: false; reason: string } {
  const normalized = command.trim();
  if (!normalized) {
    return { ok: false, reason: "comando vazio" };
  }
  for (const rule of UNSUPPORTED_ALLOWLIST_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return { ok: false, reason: rule.reason };
    }
  }
  const bins = extractCommandBins(normalized);
  if (bins.length === 0) {
    return { ok: false, reason: "nao foi possivel identificar comando executavel" };
  }
  return { ok: true, bins };
}

function sortByCreatedDesc(entries: ExecApprovalEntry[]): ExecApprovalEntry[] {
  return [...entries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export class ExecApprovalStore {
  private lock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly defaults: ExecApprovalStoreDefaults,
  ) {}

  async init(): Promise<void> {
    await this.withLock(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const current = await this.readCurrentUnlocked();
      await this.writeCurrentUnlocked(current);
    });
  }

  async getPolicy(): Promise<ExecPolicy> {
    const current = await this.withLock(() => this.readCurrentUnlocked());
    return {
      security: current.security,
      ask: current.ask,
      allowlist: new Set(current.allowlist),
    };
  }

  async listApprovals(params?: {
    status?: ExecApprovalStatus | "open";
    limit?: number;
  }): Promise<ExecApprovalEntry[]> {
    const current = await this.withLock(() => this.readCurrentUnlocked());
    const limit = Number.isFinite(params?.limit) && (params?.limit ?? 0) > 0 ? Math.floor(params?.limit ?? 0) : 100;

    const filtered = current.pending.filter((entry) => {
      if (!params?.status) {
        return true;
      }
      if (params.status === "open") {
        return entry.status === "pending";
      }
      return entry.status === params.status;
    });

    return sortByCreatedDesc(filtered).slice(0, limit);
  }

  async resolveApproval(approvalId: string, decision: "approved" | "denied"): Promise<ExecApprovalEntry | null> {
    return this.withLock(async () => {
      const current = await this.readCurrentUnlocked();
      const idx = current.pending.findIndex((entry) => entry.id === approvalId);
      if (idx < 0) {
        return null;
      }

      const target = current.pending[idx];
      if (target.status !== "pending") {
        return target;
      }

      const decided: ExecApprovalEntry = {
        ...target,
        status: decision,
        decidedAt: new Date().toISOString(),
      };

      const nextEntries = [...current.pending];
      nextEntries[idx] = decided;
      await this.writeCurrentUnlocked({
        ...current,
        pending: nextEntries.slice(-MAX_APPROVAL_HISTORY),
        updatedAt: new Date().toISOString(),
      });

      return decided;
    });
  }

  async waitForDecision(
    approvalId: string,
    params: { timeoutMs: number; pollMs?: number },
  ): Promise<ExecApprovalWaitResult> {
    const timeoutMs = Math.max(1, Math.floor(params.timeoutMs));
    const pollMs = Math.max(50, Math.floor(params.pollMs ?? 700));
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const current = await this.withLock(() => this.readCurrentUnlocked());
      const entry = current.pending.find((item) => item.id === approvalId);
      if (!entry) {
        return {
          status: "expired",
          reason: "Solicitacao de aprovacao nao encontrada (possivel expiracao).",
        };
      }

      if (entry.status === "approved") {
        return { status: "approved", reason: "Comando aprovado manualmente." };
      }
      if (entry.status === "denied") {
        return { status: "denied", reason: "Comando negado manualmente." };
      }
      if (entry.status === "expired") {
        return { status: "expired", reason: "Solicitacao de aprovacao expirou." };
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, pollMs);
      });
    }

    return {
      status: "timeout",
      reason: `Tempo limite aguardando aprovacao manual (${timeoutMs}ms).`,
    };
  }

  async evaluateCommand(params: {
    command: string;
    cwd: string;
    askOverride?: ExecAsk;
    securityOverride?: ExecSecurity;
  }): Promise<ExecPendingDecision | null> {
    return this.withLock(async () => {
      const current = await this.readCurrentUnlocked();
      const security = params.securityOverride ?? current.security;
      const ask = params.askOverride ?? current.ask;
      const allowlistAnalysis = analyzeAllowlistCommand(params.command);
      const bins = allowlistAnalysis.ok ? allowlistAnalysis.bins : [];

      if (security === "deny") {
        return { status: "denied", reason: "Exec bloqueado: security=deny" };
      }

      const allowedByAllowlist =
        security === "full" ||
        (allowlistAnalysis.ok && bins.every((bin) => current.allowlist.includes(bin)));

      const missingBins = bins.filter((bin) => !current.allowlist.includes(bin));
      const allowlistReason = !allowlistAnalysis.ok
        ? allowlistAnalysis.reason
        : missingBins.length > 0
          ? `comando fora da allowlist: ${missingBins.join(", ")}`
          : "comando requer aprovacao por politica ask";

      if (allowedByAllowlist && ask !== "always") {
        return null;
      }

      if (!allowedByAllowlist && ask === "off") {
        return {
          status: "denied",
          reason: allowlistReason,
        };
      }

      const approvalId = randomUUID();
      const now = Date.now();
      const pending: ExecApprovalEntry = {
        id: approvalId,
        command: params.command,
        cwd: params.cwd,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + DEFAULT_PENDING_TTL_MS).toISOString(),
        status: "pending",
      };

      await this.writeCurrentUnlocked({
        ...current,
        pending: [...current.pending, pending].slice(-MAX_APPROVAL_HISTORY),
        updatedAt: new Date().toISOString(),
      });

      return {
        status: "approval-pending",
        approvalId,
        reason: `Comando requer aprovacao manual (exec-approvals): ${allowlistReason}.`,
      };
    });
  }

  private async readCurrentUnlocked(): Promise<ExecApprovalsFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      return sanitizeFile(JSON.parse(raw), this.defaults);
    } catch {
      const fallback = defaultFile(this.defaults);
      await this.writeCurrentUnlocked(fallback);
      return fallback;
    }
  }

  private async writeCurrentUnlocked(next: ExecApprovalsFile): Promise<void> {
    const dir = path.dirname(this.filePath);
    const tmpPath = path.join(dir, `${path.basename(this.filePath)}.tmp-${randomUUID()}`);
    await fs.writeFile(tmpPath, JSON.stringify(next, null, 2), "utf-8");
    await fs.rename(tmpPath, this.filePath);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.lock;
    let release: () => void = () => {};
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
