import { randomUUID } from "node:crypto";
import path from "node:path";
import { kaelLogger } from "../../infra/logger.js";
import { LocalProcessRunner } from "./process-runner.js";
import {
  ExecApprovalStore,
  type ExecApprovalEntry,
  type ExecAsk,
  type ExecSecurity,
} from "./shell-approvals.js";

export type ExecStatus =
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "timed_out"
  | "approval-pending"
  | "denied";

export type ExecSession = {
  id: string;
  command: string;
  cwd: string;
  status: ExecStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  outputTail: string;
  approvalId?: string;
};

type ActiveProcess = {
  session: ExecSession;
  killRequested: boolean;
  process: ReturnType<LocalProcessRunner["spawn"]>["process"];
  completion: Promise<ExecSession>;
};

export type ExecCommandParams = {
  sessionKey: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  background?: boolean;
  security?: ExecSecurity;
  ask?: ExecAsk;
};

export type ProcessAction = "list" | "poll" | "kill";

export type ProcessCommandParams = {
  sessionKey: string;
  action: ProcessAction;
  sessionId?: string;
};

export type ProcessCommandResult = {
  ok: boolean;
  action: ProcessAction;
  sessions?: ExecSession[];
  session?: ExecSession;
  message?: string;
};

type ShellToolConfig = {
  workspaceRoot: string;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  maxOutputChars: number;
  approvalWaitMs: number;
  security: ExecSecurity;
  ask: ExecAsk;
  allowlist: string[];
  approvalsPath: string;
};

function clampTimeout(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function appendWithCap(current: string, chunk: string, maxChars: number): string {
  const next = current + chunk;
  if (next.length <= maxChars) {
    return next;
  }
  return next.slice(next.length - maxChars);
}

export class ShellToolService {
  private readonly runner = new LocalProcessRunner();
  private readonly sessions = new Map<string, ExecSession>();
  private readonly active = new Map<string, ActiveProcess>();
  private readonly approvals: ExecApprovalStore;

  constructor(private readonly cfg: ShellToolConfig) {
    this.approvals = new ExecApprovalStore(cfg.approvalsPath, {
      security: cfg.security,
      ask: cfg.ask,
      allowlist: cfg.allowlist,
    });
  }

  async init(): Promise<void> {
    await this.approvals.init();
  }

  async listApprovals(params?: {
    status?: "pending" | "approved" | "denied" | "expired" | "open";
    limit?: number;
  }): Promise<ExecApprovalEntry[]> {
    return this.approvals.listApprovals(params);
  }

  async resolveApproval(
    approvalId: string,
    decision: "approved" | "denied",
  ): Promise<ExecApprovalEntry | null> {
    return this.approvals.resolveApproval(approvalId, decision);
  }

  async exec(params: ExecCommandParams): Promise<ExecSession> {
    const command = params.command.trim();
    if (!command) {
      throw new Error("exec: command vazio");
    }

    const cwd = this.resolveCwd(params.cwd);
    const timeoutMs = clampTimeout(params.timeoutMs, this.cfg.defaultTimeoutMs, this.cfg.maxTimeoutMs);

    const decision = await this.approvals.evaluateCommand({
      command,
      cwd,
      askOverride: params.ask,
      securityOverride: params.security,
    });

    if (decision?.status === "denied") {
      const denied: ExecSession = {
        id: randomUUID(),
        command,
        cwd,
        status: "denied",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        outputTail: decision.reason,
      };
      this.sessions.set(denied.id, denied);
      kaelLogger.warn("shell.exec.denied", {
        sessionKey: params.sessionKey,
        command,
        cwd,
        reason: decision.reason,
      });
      return denied;
    }

    if (decision?.status === "approval-pending") {
      const pending: ExecSession = {
        id: randomUUID(),
        command,
        cwd,
        status: "approval-pending",
        startedAt: new Date().toISOString(),
        outputTail: decision.reason,
        approvalId: decision.approvalId,
      };
      this.sessions.set(pending.id, pending);
      kaelLogger.info("shell.exec.approval_pending", {
        sessionKey: params.sessionKey,
        command,
        cwd,
        approvalId: decision.approvalId,
      });

      const waitResult = await this.approvals.waitForDecision(decision.approvalId ?? "", {
        timeoutMs: this.cfg.approvalWaitMs,
      });

      if (waitResult.status !== "approved") {
        const deniedPending: ExecSession = {
          ...pending,
          status: "denied",
          endedAt: new Date().toISOString(),
          outputTail: waitResult.reason,
        };
        this.sessions.set(deniedPending.id, deniedPending);
        kaelLogger.warn("shell.exec.approval_not_granted", {
          sessionKey: params.sessionKey,
          command,
          cwd,
          approvalId: decision.approvalId,
          result: waitResult.status,
        });
        return deniedPending;
      }

      pending.status = "running";
      pending.outputTail = "";
      pending.endedAt = undefined;
      const started = this.startProcess({
        sessionKey: params.sessionKey,
        command,
        cwd,
        timeoutMs,
        existingSession: pending,
      });
      if (params.background) {
        return started;
      }
      const startedActive = this.active.get(started.id);
      if (!startedActive) {
        return started;
      }
      return startedActive.completion;
    }

    const session = this.startProcess({
      sessionKey: params.sessionKey,
      command,
      cwd,
      timeoutMs,
    });

    if (params.background) {
      return session;
    }

    const active = this.active.get(session.id);
    if (!active) {
      return session;
    }

    return active.completion;
  }

  async process(params: ProcessCommandParams): Promise<ProcessCommandResult> {
    if (params.action === "list") {
      return {
        ok: true,
        action: "list",
        sessions: Array.from(this.sessions.values()).slice(-25),
      };
    }

    if (!params.sessionId) {
      return {
        ok: false,
        action: params.action,
        message: "sessionId e obrigatorio para poll/kill",
      };
    }

    const session = this.sessions.get(params.sessionId);
    if (!session) {
      return {
        ok: false,
        action: params.action,
        message: `session ${params.sessionId} nao encontrada`,
      };
    }

    if (params.action === "poll") {
      return {
        ok: true,
        action: "poll",
        session,
      };
    }

    const active = this.active.get(params.sessionId);
    if (!active) {
      return {
        ok: false,
        action: "kill",
        session,
        message: `session ${params.sessionId} nao esta em execucao`,
      };
    }

    active.killRequested = true;
    active.process.kill("SIGTERM");

    kaelLogger.warn("shell.process.kill_requested", {
      sessionKey: params.sessionKey,
      command: session.command,
      sessionId: session.id,
    });

    return {
      ok: true,
      action: "kill",
      session,
      message: `SIGTERM enviado para session ${params.sessionId}`,
    };
  }

  private startProcess(params: {
    sessionKey: string;
    command: string;
    cwd: string;
    timeoutMs: number;
    existingSession?: ExecSession;
  }): ExecSession {
    const session: ExecSession = params.existingSession ?? {
      id: randomUUID(),
      command: params.command,
      cwd: params.cwd,
      status: "running",
      startedAt: new Date().toISOString(),
      outputTail: "",
    };

    this.sessions.set(session.id, session);

    const child = this.runner.spawn("sh", ["-lc", params.command], { cwd: params.cwd });

    kaelLogger.info("shell.exec.started", {
      sessionKey: params.sessionKey,
      sessionId: session.id,
      command: params.command,
      cwd: params.cwd,
      timeoutMs: params.timeoutMs,
    });

    const completion = new Promise<ExecSession>((resolve) => {
      let settled = false;
      const finish = (next: Partial<ExecSession>): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        const endedAt = new Date().toISOString();
        const finalSession: ExecSession = {
          ...session,
          ...next,
          endedAt,
        };
        this.sessions.set(session.id, finalSession);
        this.active.delete(session.id);
        kaelLogger.info("shell.exec.finished", {
          sessionKey: params.sessionKey,
          sessionId: finalSession.id,
          command: finalSession.command,
          status: finalSession.status,
          exitCode: finalSession.exitCode ?? null,
          durationMs:
            Date.parse(finalSession.endedAt ?? endedAt) - Date.parse(finalSession.startedAt),
        });
        resolve(finalSession);
      };

      child.process.stdout.on("data", (chunk) => {
        session.outputTail = appendWithCap(
          session.outputTail,
          String(chunk),
          this.cfg.maxOutputChars,
        );
        this.sessions.set(session.id, { ...session });
      });

      child.process.stderr.on("data", (chunk) => {
        session.outputTail = appendWithCap(
          session.outputTail,
          String(chunk),
          this.cfg.maxOutputChars,
        );
        this.sessions.set(session.id, { ...session });
      });

      child.process.on("error", (error) => {
        finish({
          status: "failed",
          exitCode: null,
          outputTail: appendWithCap(
            session.outputTail,
            `\n[process-error] ${error.message}\n`,
            this.cfg.maxOutputChars,
          ),
        });
      });

      child.process.on("close", (code) => {
        if (session.status === "timed_out") {
          finish({
            status: "timed_out",
            exitCode: code,
            timedOut: true,
            outputTail: session.outputTail,
          });
          return;
        }

        if (active.killRequested) {
          finish({
            status: "canceled",
            exitCode: code,
            outputTail: session.outputTail,
          });
          return;
        }

        finish({
          status: code === 0 ? "completed" : "failed",
          exitCode: code,
          outputTail: session.outputTail,
        });
      });

      const timeout = setTimeout(() => {
        session.status = "timed_out";
        session.timedOut = true;
        session.outputTail = appendWithCap(
          session.outputTail,
          `\n[timeout] processo excedeu ${params.timeoutMs}ms\n`,
          this.cfg.maxOutputChars,
        );
        child.process.kill("SIGTERM");
        setTimeout(() => {
          if (!child.process.killed) {
            child.process.kill("SIGKILL");
          }
        }, 1500);
      }, params.timeoutMs);
    });

    const active: ActiveProcess = {
      session,
      killRequested: false,
      process: child.process,
      completion,
    };

    this.active.set(session.id, active);
    return session;
  }

  private resolveCwd(input?: string): string {
    const base = this.cfg.workspaceRoot;
    const resolved = input ? path.resolve(base, input) : base;
    const normalizedBase = path.resolve(base);
    const normalizedResolved = path.resolve(resolved);

    if (normalizedResolved === normalizedBase) {
      return normalizedResolved;
    }

    if (normalizedResolved.startsWith(`${normalizedBase}${path.sep}`)) {
      return normalizedResolved;
    }

    throw new Error(`cwd fora do workspace permitido: ${normalizedResolved}`);
  }
}
