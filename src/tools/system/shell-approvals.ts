import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ExecSecurity = "deny" | "allowlist" | "full";
export type ExecAsk = "off" | "on-miss" | "always";

export type ExecApprovalEntry = {
  id: string;
  command: string;
  cwd: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "denied";
};

export type ExecApprovalsFile = {
  version: 1;
  security: ExecSecurity;
  ask: ExecAsk;
  allowlist: string[];
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

export type ExecApprovalStoreDefaults = {
  security: ExecSecurity;
  ask: ExecAsk;
  allowlist: string[];
};

const DEFAULT_PENDING_TTL_MS = 10 * 60 * 1000;

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

function isPendingStatus(value: unknown): value is ExecApprovalEntry["status"] {
  return value === "pending" || value === "approved" || value === "denied";
}

function sanitizeFile(raw: unknown, defaults: ExecApprovalStoreDefaults): ExecApprovalsFile {
  if (!raw || typeof raw !== "object") {
    return defaultFile(defaults);
  }

  const typed = raw as Partial<ExecApprovalsFile>;
  const security = isExecSecurity(typed.security) ? typed.security : defaults.security;
  const ask = isExecAsk(typed.ask) ? typed.ask : defaults.ask;
  const pending = Array.isArray(typed.pending)
    ? typed.pending
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
            isPendingStatus(candidate.status)
          );
        })
        .filter((item) => Date.parse(item.expiresAt) > Date.now())
    : [];

  return {
    version: 1,
    security,
    ask,
    allowlist: normalizeAllowlist(Array.isArray(typed.allowlist) ? typed.allowlist : defaults.allowlist),
    pending,
    updatedAt: new Date().toISOString(),
  };
}

export function extractCommandBins(command: string): string[] {
  const normalized = command.trim();
  if (!normalized) {
    return [];
  }

  const segments = normalized
    .split(/\|\||&&|\||;/g)
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

export class ExecApprovalStore {
  constructor(
    private readonly filePath: string,
    private readonly defaults: ExecApprovalStoreDefaults,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = sanitizeFile(JSON.parse(raw), this.defaults);
      await fs.writeFile(this.filePath, JSON.stringify(parsed, null, 2), "utf-8");
    } catch {
      const initial = defaultFile(this.defaults);
      await fs.writeFile(this.filePath, JSON.stringify(initial, null, 2), "utf-8");
    }
  }

  async getPolicy(): Promise<ExecPolicy> {
    const current = await this.readCurrent();
    return {
      security: current.security,
      ask: current.ask,
      allowlist: new Set(current.allowlist),
    };
  }

  async evaluateCommand(params: {
    command: string;
    cwd: string;
    askOverride?: ExecAsk;
    securityOverride?: ExecSecurity;
  }): Promise<ExecPendingDecision | null> {
    const current = await this.readCurrent();
    const security = params.securityOverride ?? current.security;
    const ask = params.askOverride ?? current.ask;
    const bins = extractCommandBins(params.command);

    if (security === "deny") {
      return { status: "denied", reason: "Exec bloqueado: security=deny" };
    }

    const allowedByAllowlist =
      security === "full" || (bins.length > 0 && bins.every((bin) => current.allowlist.includes(bin)));

    if (allowedByAllowlist && ask !== "always") {
      return null;
    }

    if (!allowedByAllowlist && ask === "off") {
      return {
        status: "denied",
        reason: `Comando fora da allowlist: ${bins.join(", ") || "(sem comando identificavel)"}`,
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

    const next: ExecApprovalsFile = {
      ...current,
      pending: [...current.pending.filter((item) => item.status === "pending"), pending],
      updatedAt: new Date().toISOString(),
    };
    await this.writeCurrent(next);

    return {
      status: "approval-pending",
      approvalId,
      reason: "Comando requer aprovacao manual (exec-approvals).",
    };
  }

  private async readCurrent(): Promise<ExecApprovalsFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = sanitizeFile(JSON.parse(raw), this.defaults);
      return parsed;
    } catch {
      const fallback = defaultFile(this.defaults);
      await this.writeCurrent(fallback);
      return fallback;
    }
  }

  private async writeCurrent(next: ExecApprovalsFile): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), "utf-8");
  }
}
