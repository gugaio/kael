import { randomUUID } from "node:crypto";
import { kaelLogger } from "../../infra/logger.js";
import type { LocalProcessRunner } from "./process-runner.js";
import type { ExecSession, ProcessCommandParams, ProcessCommandResult } from "./shell-tool-service.js";

type ActiveProcess = {
  session: ExecSession;
  killRequested: boolean;
  process: ReturnType<LocalProcessRunner["spawn"]>["process"];
  completion: Promise<ExecSession>;
};

type SupervisorConfig = {
  maxOutputChars: number;
  noOutputTimeoutMs: number;
};

type StartProcessParams = {
  sessionKey: string;
  command: string;
  cwd: string;
  timeoutMs: number;
  resolveShell: () => { command: "bash" | "sh"; args: string[] };
  looksLikeCommandNotFound: (code: number | null, outputTail: string) => boolean;
  existingSession?: ExecSession;
};

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

export class ShellProcessSupervisor {
  private readonly sessions = new Map<string, ExecSession>();
  private readonly active = new Map<string, ActiveProcess>();
  private readonly removedSessions = new Set<string>();

  constructor(
    private readonly runner: LocalProcessRunner,
    private readonly cfg: SupervisorConfig,
  ) {}

  upsertSession(session: ExecSession): void {
    if (this.removedSessions.has(session.id)) {
      return;
    }
    this.sessions.set(session.id, session);
  }

  startProcess(params: StartProcessParams): ExecSession {
    const session: ExecSession = params.existingSession ?? {
      id: randomUUID(),
      command: params.command,
      cwd: params.cwd,
      status: "running",
      startedAt: new Date().toISOString(),
      outputTail: "",
      failureCode: "none",
    };

    this.removedSessions.delete(session.id);
    this.sessions.set(session.id, session);

    const shell = params.resolveShell();
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
        if (!this.removedSessions.has(session.id)) {
          this.sessions.set(session.id, finalSession);
        }
        this.active.delete(session.id);
        kaelLogger.info("shell.exec.finished", {
          sessionKey: params.sessionKey,
          sessionId: finalSession.id,
          command: finalSession.command,
          status: finalSession.status,
          exitCode: finalSession.exitCode ?? null,
          failureCode: finalSession.failureCode ?? "none",
          outputTail: finalSession.status === "completed" ? undefined : tailSnippet(finalSession.outputTail),
          durationMs: Date.parse(finalSession.endedAt ?? endedAt) - Date.parse(finalSession.startedAt),
        });
        resolve(finalSession);
      };

      const onOutput = (chunk: unknown): void => {
        session.outputTail = appendWithCap(session.outputTail, String(chunk), this.cfg.maxOutputChars);
        lastOutputAtMs = Date.now();
        if (!this.removedSessions.has(session.id)) {
          this.sessions.set(session.id, { ...session });
        }
      };

      child.process.stdout.on("data", onOutput);
      child.process.stderr.on("data", onOutput);

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
              : params.looksLikeCommandNotFound(code, session.outputTail)
                ? "command_not_found"
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

  getCompletion(sessionId: string): Promise<ExecSession> | null {
    return this.active.get(sessionId)?.completion ?? null;
  }

  async processCommand(params: ProcessCommandParams): Promise<ProcessCommandResult> {
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
      this.removedSessions.add(params.sessionId);
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
}
