import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
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

export type ExecFailureCode =
  | "none"
  | "approval_denied"
  | "allowlist_miss"
  | "syntax_error"
  | "process_error"
  | "timeout_overall"
  | "timeout_no_output"
  | "signal"
  | "non_zero_exit";

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
  failureCode?: ExecFailureCode;
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

export type ProcessAction = "list" | "poll" | "kill" | "log" | "remove";

export type ProcessCommandParams = {
  sessionKey: string;
  action: ProcessAction;
  sessionId?: string;
  offset?: number;
  limit?: number;
};

export type ProcessCommandResult = {
  ok: boolean;
  action: ProcessAction;
  sessions?: ExecSession[];
  session?: ExecSession;
  output?: string;
  message?: string;
};

type ShellToolConfig = {
  workspaceRoot: string;
  defaultTimeoutMs: number;
  noOutputTimeoutMs: number;
  maxTimeoutMs: number;
  maxOutputChars: number;
  approvalWaitMs: number;
  security: ExecSecurity;
  ask: ExecAsk;
  allowlist: string[];
  approvalsPath: string;
};

type ResolvedShell = {
  command: "bash" | "sh";
  args: string[];
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

function tailSnippet(value: string, maxChars = 280): string {
  if (!value) {
    return "";
  }
  return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}

export class ShellToolService {
  private readonly runner = new LocalProcessRunner();
  private readonly sessions = new Map<string, ExecSession>();
  private readonly active = new Map<string, ActiveProcess>();
  private readonly approvals: ExecApprovalStore;
  private shellChoice: ResolvedShell | null = null;

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
    const preflightError = this.preflightCommand(command, cwd);
    if (preflightError) {
      const failed: ExecSession = {
        id: randomUUID(),
        command,
        cwd,
        status: "failed",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        outputTail: `[preflight] ${preflightError}`,
        exitCode: 2,
        failureCode: "syntax_error",
      };
      this.sessions.set(failed.id, failed);
      kaelLogger.warn("shell.exec.preflight_failed", {
        sessionKey: params.sessionKey,
        command,
        cwd,
        reason: preflightError,
      });
      return failed;
    }

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
        failureCode: decision.reason.toLowerCase().includes("allowlist")
          ? "allowlist_miss"
          : "approval_denied",
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
        reason: decision.reason,
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
          failureCode: "approval_denied",
        };
        this.sessions.set(deniedPending.id, deniedPending);
        kaelLogger.warn("shell.exec.approval_not_granted", {
          sessionKey: params.sessionKey,
          command,
          cwd,
          approvalId: decision.approvalId,
          result: waitResult.status,
          reason: waitResult.reason,
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
        sessions: Array.from(this.sessions.values())
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
          .slice(0, 50),
      };
    }

    if (!params.sessionId) {
      return {
        ok: false,
        action: params.action,
        message: "sessionId e obrigatorio para poll/kill/log/remove",
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

    if (params.action === "log") {
      const total = session.outputTail.length;
      const offset = Number.isFinite(params.offset) ? Math.max(0, Math.floor(params.offset ?? 0)) : 0;
      const limit = Number.isFinite(params.limit) ? Math.max(1, Math.floor(params.limit ?? 4000)) : 4000;
      const end = Math.min(total, offset + limit);
      return {
        ok: true,
        action: "log",
        session,
        output: session.outputTail.slice(offset, end),
        message: `offset=${offset} end=${end} total=${total}`,
      };
    }

    if (params.action === "remove") {
      const activeSession = this.active.get(params.sessionId);
      if (activeSession) {
        activeSession.killRequested = true;
        activeSession.process.kill("SIGTERM");
      }
      this.active.delete(params.sessionId);
      this.sessions.delete(params.sessionId);
      return {
        ok: true,
        action: "remove",
        message: `session ${params.sessionId} removida`,
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
      failureCode: "none",
    };

    this.sessions.set(session.id, session);

    const shell = this.resolveShell();
    const child = this.runner.spawn(shell.command, [...shell.args, params.command], { cwd: params.cwd });

    kaelLogger.info("shell.exec.started", {
      sessionKey: params.sessionKey,
      sessionId: session.id,
      command: params.command,
      cwd: params.cwd,
      timeoutMs: params.timeoutMs,
    });

    let active!: ActiveProcess;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let noOutputTimeoutHandle: ReturnType<typeof setInterval> | undefined;
    let lastOutputAtMs = Date.now();
    const completion = new Promise<ExecSession>((resolve) => {
      let settled = false;
      const finish = (next: Partial<ExecSession>): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (noOutputTimeoutHandle) {
          clearInterval(noOutputTimeoutHandle);
        }
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
          failureCode: finalSession.failureCode ?? "none",
          outputTail: finalSession.status === "completed" ? undefined : tailSnippet(finalSession.outputTail),
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
        lastOutputAtMs = Date.now();
        this.sessions.set(session.id, { ...session });
      });

      child.process.stderr.on("data", (chunk) => {
        session.outputTail = appendWithCap(
          session.outputTail,
          String(chunk),
          this.cfg.maxOutputChars,
        );
        lastOutputAtMs = Date.now();
        this.sessions.set(session.id, { ...session });
      });

      child.process.on("error", (error) => {
        finish({
          status: "failed",
          exitCode: null,
          failureCode: "process_error",
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
            failureCode: session.failureCode ?? "timeout_overall",
            outputTail: session.outputTail,
          });
          return;
        }

        if (active.killRequested) {
          finish({
            status: "canceled",
            exitCode: code,
            failureCode: "none",
            outputTail: session.outputTail,
          });
          return;
        }

        finish({
          status: code === 0 ? "completed" : "failed",
          exitCode: code,
          failureCode:
            code === 0
              ? "none"
              : child.process.signalCode
                ? "signal"
                : "non_zero_exit",
          outputTail: session.outputTail,
        });
      });

      timeoutHandle = setTimeout(() => {
        session.status = "timed_out";
        session.timedOut = true;
        session.failureCode = "timeout_overall";
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

      noOutputTimeoutHandle = setInterval(() => {
        if (session.status !== "running") {
          return;
        }
        const idleMs = Date.now() - lastOutputAtMs;
        if (idleMs < this.cfg.noOutputTimeoutMs) {
          return;
        }
        session.status = "timed_out";
        session.timedOut = true;
        session.failureCode = "timeout_no_output";
        session.outputTail = appendWithCap(
          session.outputTail,
          `\n[timeout] processo sem output por ${this.cfg.noOutputTimeoutMs}ms\n`,
          this.cfg.maxOutputChars,
        );
        child.process.kill("SIGTERM");
      }, Math.min(this.cfg.noOutputTimeoutMs, 2_000));
    });

    active = {
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

  private preflightCommand(command: string, cwd: string): string | null {
    try {
      const shell = this.resolveShell();
      const check = spawnSync(shell.command, ["-n", ...shell.args, command], {
        cwd,
        encoding: "utf8",
        timeout: 2000,
        maxBuffer: 64 * 1024,
      });
      if (check.error) {
        const code = (check.error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
          // Ambiente restrito (tests/sandbox): nao bloquear execucao por indisponibilidade do validador.
          return null;
        }
        return `falha no preflight: ${check.error.message}`;
      }
      if ((check.status ?? 0) !== 0) {
        const stderr = String(check.stderr ?? "").trim();
        const stdout = String(check.stdout ?? "").trim();
        const details = stderr || stdout || `${shell.command} -n retornou ${check.status}`;
        return `sintaxe shell invalida: ${details}`;
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `preflight exception: ${message}`;
    }
  }

  private resolveShell(): ResolvedShell {
    if (this.shellChoice) {
      return this.shellChoice;
    }

    const bashCheck = spawnSync("bash", ["-lc", "true"], {
      encoding: "utf8",
      timeout: 1000,
      stdio: "ignore",
    });
    if (!bashCheck.error && (bashCheck.status ?? 1) === 0) {
      this.shellChoice = { command: "bash", args: ["-lc"] };
      return this.shellChoice;
    }

    this.shellChoice = { command: "sh", args: ["-c"] };
    return this.shellChoice;
  }
}
