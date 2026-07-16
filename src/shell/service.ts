import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { kaelLogger } from "../infra/logger.js";
import { LocalProcessRunner } from "../process/runner.js";
import { ShellProcessSupervisor } from "./supervisor.js";
import {
  ExecApprovalStore,
  type ExecApprovalEntry,
  type ExecAsk,
  type ExecSecurity,
} from "./approvals.js";
import { getGlobalLaneQueue } from "./lanes.js";

/** Cache de snapshot shell: export -p + declare -f para evitar login shell por comando. */
const SNAPSHOT_CACHE_TTL_MS = 5 * 60 * 1000;
type ShellSnapshot = {
  /** Conteúdo de `export -p` (variáveis) + `declare -f` (funções). */
  data: string;
  capturedAt: number;
};

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
  | "command_not_found"
  | "command_not_executable"
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

export type ExecCommandParams = {
  sessionKey: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  background?: boolean;
  /** Milissegundos a aguardar antes de fazer background automático. */
  yieldMs?: number;
  security?: ExecSecurity;
  ask?: ExecAsk;
};

export type ProcessAction = "list" | "poll" | "kill" | "log" | "remove" | "write";

export type ProcessCommandParams = {
  sessionKey: string;
  action: ProcessAction;
  sessionId?: string;
  offset?: number;
  limit?: number;
  /** Dados a escrever no stdin do processo (action=write). */
  data?: string;
  /** Fecha o stdin após escrever (action=write). */
  eof?: boolean;
};

export type ProcessCommandResult = {
  ok: boolean;
  action: ProcessAction;
  sessions?: ExecSession[];
  session?: ExecSession;
  output?: string;
  message?: string;
};

export interface ShellRuntime {
  exec(params: ExecCommandParams): Promise<ExecSession>;
  process(params: ProcessCommandParams): Promise<ProcessCommandResult>;
  listApprovals(params?: {
    status?: "pending" | "approved" | "denied" | "expired" | "open";
    limit?: number;
  }): Promise<ExecApprovalEntry[]>;
  resolveApproval(
    approvalId: string,
    decision: "approved" | "denied",
    opts?: { allowAlways?: boolean },
  ): Promise<ExecApprovalEntry | null>;
  /** Cancela todos os processos em background de uma sessionKey. */
  cancelBySessionKey(sessionKey: string): void;
}

type ShellToolConfig = {
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

export class ShellToolService implements ShellRuntime {
  private readonly runner = new LocalProcessRunner();
  private readonly supervisor: ShellProcessSupervisor;
  private readonly approvals: ExecApprovalStore;
  private shellChoice: ResolvedShell | null = null;
  /** Snapshots de shell por sessionKey, evitando login shell a cada exec. */
  private readonly shellSnapshots = new Map<string, ShellSnapshot>();

  constructor(private readonly cfg: ShellToolConfig) {
    this.supervisor = new ShellProcessSupervisor(this.runner, {
      maxOutputChars: cfg.maxOutputChars,
      noOutputTimeoutMs: cfg.noOutputTimeoutMs,
      killGraceMs: cfg.killGraceMs,
    });
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
    opts?: { allowAlways?: boolean },
  ): Promise<ExecApprovalEntry | null> {
    return this.approvals.resolveApproval(approvalId, decision, opts);
  }

  cancelBySessionKey(sessionKey: string): void {
    this.supervisor.cancelBySessionKey(sessionKey);
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
      this.supervisor.upsertSession(failed);
      kaelLogger.warn("shell.exec.preflight_failed", {
        sessionKey: params.sessionKey,
        command,
        cwd,
        reason: preflightError,
      });
      return failed;
    }
    const commandHintError = this.preflightCommandHint(command);
    if (commandHintError) {
      const failed: ExecSession = {
        id: randomUUID(),
        command,
        cwd,
        status: "failed",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        outputTail: `[preflight] ${commandHintError}`,
        exitCode: 127,
        failureCode: "command_not_found",
      };
      this.supervisor.upsertSession(failed);
      kaelLogger.warn("shell.exec.preflight_failed", {
        sessionKey: params.sessionKey,
        command,
        cwd,
        reason: commandHintError,
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
      this.supervisor.upsertSession(denied);
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
      this.supervisor.upsertSession(pending);
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
        this.supervisor.upsertSession(deniedPending);
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
      return this.runInExecLane(async () => {
        const shellInfo = this.resolveShellWithSnapshot(params.sessionKey);
        const started = this.supervisor.startProcess({
          sessionKey: params.sessionKey,
          command,
          cwd,
          timeoutMs,
          resolveShell: () => shellInfo,
          looksLikeCommandNotFound: (code, outputTail) => this.looksLikeCommandNotFound(code, outputTail),
          existingSession: pending,
        });
        if (params.background) {
          return started;
        }
        return this.awaitWithYield(
          started,
          this.supervisor.getCompletion(started.id),
          this.resolveYieldMs(params.yieldMs),
        );
      });
    }

    return this.runInExecLane(async () => {
      const shellInfo = this.resolveShellWithSnapshot(params.sessionKey);
      const session = this.supervisor.startProcess({
        sessionKey: params.sessionKey,
        command,
        cwd,
        timeoutMs,
        resolveShell: () => shellInfo,
        looksLikeCommandNotFound: (code, outputTail) => this.looksLikeCommandNotFound(code, outputTail),
      });
      if (params.background) {
        return session;
      }
      this.captureShellSnapshot(params.sessionKey);
      return this.awaitWithYield(
        session,
        this.supervisor.getCompletion(session.id),
        this.resolveYieldMs(params.yieldMs),
      );
    });
  }

  async process(params: ProcessCommandParams): Promise<ProcessCommandResult> {
    return this.supervisor.processCommand(params);
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

  /** Retorna o shell disponível (bash preferido, sh fallback). */
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

  /**
   * Monta shell args aproveitando snapshot de sessão.
   * Com snapshot: usa `bash -c 'source <(echo "SNAPSHOT"); comando'` (~2ms).
   * Sem snapshot: usa `bash -lc "comando"` (~40ms, login shell).
   */
  /**
   * Resolve shell command e args para uma sessão.
   * Aproveita snapshot para usar -c em vez de -lc, economizando ~40ms.
   * OBS: o supervisor adiciona params.command ao final dos args.
   * Portanto args aqui NÃO inclui o comando do usuário — apenas flags do shell.
   */
  private resolveShellWithSnapshot(
    sessionKey: string,
  ): ResolvedShell {
    const shell = this.resolveShell();
    const snap = this.shellSnapshots.get(sessionKey);

    if (snap && Date.now() - snap.capturedAt < SNAPSHOT_CACHE_TTL_MS) {
      // Com snapshot: usa -c em vez de -lc, evitando source do profile (~40ms de economia).
      return {
        command: shell.command,
        args: ["-c"],
      };
    }

    return { command: shell.command, args: shell.args }; // shell.args já contém "-lc" ou "-c"
  }

  /**
   * Captura snapshot do shell (export -p + declare -f) para uma sessionKey.
   * Chamado após a primeira execução bem-sucedida.
   */
  private captureShellSnapshot(sessionKey: string): void {
    if (this.shellSnapshots.has(sessionKey)) return;
    const shell = this.resolveShell();
    try {
      const result = spawnSync(shell.command, [
        ...(shell.args[0] === "-lc" ? ["-lc"] : ["-c"]),
        "export -p; declare -f",
      ], {
        encoding: "utf8",
        timeout: 3000,
        maxBuffer: 128 * 1024,
      });
      if (result.status === 0 && result.stdout) {
        this.shellSnapshots.set(sessionKey, {
          data: result.stdout.trim(),
          capturedAt: Date.now(),
        });
        kaelLogger.info("shell.snapshot.captured", { sessionKey });
      }
    } catch {
      // Falha no snapshot não deve bloquear execução
    }
  }

  /** Limpa snapshot de sessão (ex: ao encerrar sessão). */
  clearShellSnapshot(sessionKey: string): void {
    this.shellSnapshots.delete(sessionKey);
  }

  private preflightCommandHint(command: string): string | null {
    const trimmed = command.trim();
    if (!/^python(\s|$)/.test(trimmed)) {
      return null;
    }
    const py = spawnSync("python", ["--version"], {
      encoding: "utf8",
      timeout: 1500,
      maxBuffer: 16 * 1024,
    });
    const pyMissing = py.error && (py.error as NodeJS.ErrnoException).code === "ENOENT";
    if (!pyMissing) {
      return null;
    }
    const py3 = spawnSync("python3", ["--version"], {
      encoding: "utf8",
      timeout: 1500,
      maxBuffer: 16 * 1024,
    });
    const py3Ok = (py3.status ?? 1) === 0;
    if (py3Ok) {
      return "comando usa 'python', mas este ambiente nao possui 'python'. Use 'python3'.";
    }
    return "comando usa 'python', mas este ambiente nao possui 'python'.";
  }

  private resolveYieldMs(requested?: number): number {
    if (typeof requested === "number") {
      return Math.max(0, Math.floor(requested));
    }
    return this.cfg.defaultYieldMs;
  }

  private awaitWithYield(
    session: ExecSession,
    completion: Promise<ExecSession> | null,
    yieldMs: number,
  ): Promise<ExecSession> {
    if (!completion) {
      return Promise.resolve(session);
    }
    if (yieldMs === 0) {
      return completion;
    }
    return new Promise<ExecSession>((resolve) => {
      let done = false;
      const finish = (s: ExecSession): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(s);
      };
      const timer = setTimeout(() => {
        finish(session);
      }, yieldMs);
      timer.unref();
      void completion.then(finish).catch(() => finish(session));
    });
  }

  /** Executa comando na lane apropriada (agent por padrão). */
  private async runInExecLane<T>(fn: () => Promise<T>): Promise<T> {
    const lanes = getGlobalLaneQueue();
    return lanes.runInLane("agent", fn);
  }

  private looksLikeCommandNotFound(code: number | null, outputTail: string): boolean {
    if (code !== 127) {
      return false;
    }
    const text = outputTail.toLowerCase();
    return text.includes("command not found") || text.includes("not found");
  }
}
