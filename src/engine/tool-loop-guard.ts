type ToolName = "exec" | "process";

type LoopGuardPolicy = {
  historySize: number;
  repeatWindowMs: number;
  repeatThreshold: number;
  cooldownMs: number;
  pollNoProgressThreshold: number;
};

type ToolLoopKey = {
  sessionKey: string;
  tool: ToolName;
  signature: string;
};

type ToolLoopState = {
  key: ToolLoopKey;
  lastSeenAt: number;
  repeatCount: number;
  noProgressCount: number;
  cooldownUntil?: number;
  lastFingerprint?: string;
};

export type LoopGuardDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      retryAfterMs: number;
    };

const DEFAULT_POLICY: LoopGuardPolicy = {
  historySize: 64,
  repeatWindowMs: 12_000,
  repeatThreshold: 4,
  cooldownMs: 8_000,
  pollNoProgressThreshold: 5,
};

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function trimTail(value: string, limit = 160): string {
  if (!value) {
    return "";
  }
  return value.length <= limit ? value : value.slice(-limit);
}

function buildSignature(tool: ToolName, params: unknown): string {
  return `${tool}:${stableStringify(params)}`;
}

function buildFingerprint(tool: ToolName, result: unknown): string {
  const raw = (result ?? {}) as Record<string, unknown>;
  if (tool === "exec") {
    return stableStringify({
      status: raw.status,
      exitCode: raw.exitCode ?? null,
      approvalId: raw.approvalId ?? null,
      outputTail: trimTail(typeof raw.outputTail === "string" ? raw.outputTail : ""),
    });
  }

  const session = raw.session && typeof raw.session === "object" ? (raw.session as Record<string, unknown>) : null;
  return stableStringify({
    action: raw.action ?? null,
    ok: raw.ok ?? false,
    message: raw.message ?? null,
    sessionStatus: session?.status ?? null,
    sessionOutputTail: trimTail(typeof session?.outputTail === "string" ? session.outputTail : ""),
    sessionsCount: Array.isArray(raw.sessions) ? raw.sessions.length : 0,
  });
}

export class ToolLoopGuard {
  private readonly states = new Map<string, ToolLoopState>();
  private readonly policy: LoopGuardPolicy;

  constructor(policy: Partial<LoopGuardPolicy> = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  beforeCall(input: { sessionKey: string; tool: ToolName; params: unknown; nowMs?: number }): LoopGuardDecision {
    const nowMs = input.nowMs ?? Date.now();
    this.prune(nowMs);

    const signature = buildSignature(input.tool, input.params);
    const stateKey = this.stateKey({ sessionKey: input.sessionKey, tool: input.tool, signature });
    const state = this.states.get(stateKey);
    if (!state?.cooldownUntil || state.cooldownUntil <= nowMs) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: "Tool loop detectado: chamadas repetidas sem progresso recente.",
      retryAfterMs: Math.max(0, state.cooldownUntil - nowMs),
    };
  }

  afterCall(input: {
    sessionKey: string;
    tool: ToolName;
    params: unknown;
    result: unknown;
    nowMs?: number;
  }): void {
    const nowMs = input.nowMs ?? Date.now();
    const signature = buildSignature(input.tool, input.params);
    const stateKey = this.stateKey({ sessionKey: input.sessionKey, tool: input.tool, signature });
    const fingerprint = buildFingerprint(input.tool, input.result);
    const existing = this.states.get(stateKey);

    const withinWindow = Boolean(existing && nowMs - existing.lastSeenAt <= this.policy.repeatWindowMs);
    const repeatCount = withinWindow ? (existing?.repeatCount ?? 0) + 1 : 1;
    const noProgressCount =
      withinWindow && existing?.lastFingerprint === fingerprint ? (existing.noProgressCount ?? 0) + 1 : 1;
    const next: ToolLoopState = {
      key: { sessionKey: input.sessionKey, tool: input.tool, signature },
      lastSeenAt: nowMs,
      repeatCount,
      noProgressCount,
      cooldownUntil: existing?.cooldownUntil && existing.cooldownUntil > nowMs ? existing.cooldownUntil : undefined,
      lastFingerprint: fingerprint,
    };

    const hitRepeatThreshold = repeatCount >= this.policy.repeatThreshold;
    const hitNoProgressThreshold =
      this.isPollNoProgressPattern(input.tool, input.params) && noProgressCount >= this.policy.pollNoProgressThreshold;

    if (hitRepeatThreshold || hitNoProgressThreshold) {
      next.cooldownUntil = nowMs + this.policy.cooldownMs;
    }

    this.states.set(stateKey, next);
    this.prune(nowMs);
  }

  private isPollNoProgressPattern(tool: ToolName, params: unknown): boolean {
    if (tool !== "process" || !params || typeof params !== "object") {
      return false;
    }
    const action = (params as { action?: unknown }).action;
    return action === "poll";
  }

  private prune(nowMs: number): void {
    if (this.states.size <= this.policy.historySize) {
      return;
    }

    const items = Array.from(this.states.entries()).sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    const removeCount = Math.max(0, items.length - this.policy.historySize);
    for (let idx = 0; idx < removeCount; idx += 1) {
      this.states.delete(items[idx][0]);
    }

    const staleAfterMs = this.policy.repeatWindowMs * 4;
    for (const [key, item] of this.states.entries()) {
      if (nowMs - item.lastSeenAt > staleAfterMs && (!item.cooldownUntil || item.cooldownUntil < nowMs)) {
        this.states.delete(key);
      }
    }
  }

  private stateKey(key: ToolLoopKey): string {
    return `${key.sessionKey}::${key.tool}::${key.signature}`;
  }
}

