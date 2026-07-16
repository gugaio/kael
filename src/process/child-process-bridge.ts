import { kaelLogger } from "../infra/logger.js";
import { killProcessTree } from "./kill-tree.js";

/**
 * Bridge de encaminhamento de sinais do processo pai para filhos.
 *
 * Registra handlers para SIGTERM, SIGINT, SIGHUP e encaminha
 * para todos os processos ativos antes de deixar o sinaloriginal
 * propagar.
 *
 * Uso:
 * ```ts
 * const bridge = new ChildProcessBridge();
 * bridge.track(pid, "session-key");
 * // no cleanup:
 * bridge.untrack(pid);
 * ```
 */
export class ChildProcessBridge {
  /** Mapa de PID -> { kind, sessionKey } para rastreio. */
  private readonly tracked = new Map<number, { kind: "shell" | "job"; sessionKey: string }>();
  /** Timestamp de when o signal handler foi registrado (para evitar double-register). */
  private registered = false;
  /** Grace period para SIGKILL após SIGTERM. */
  private readonly killGraceMs: number;

  constructor(killGraceMs = 3_000) {
    this.killGraceMs = killGraceMs;
  }

  /**
   * Registra handlers de sinal no processo atual.
   * Chamar uma vez no startup.
   */
  register(): void {
    if (this.registered) return;
    this.registered = true;

    const forward = (signal: NodeJS.Signals): void => {
      const pids = Array.from(this.tracked.keys());
      if (pids.length === 0) return;

      kaelLogger.info("signal.forwarding", {
        signal,
        children: pids.length,
        childrenDetail: Array.from(this.tracked.entries()).map(([pid, info]) => ({
          pid,
          kind: info.kind,
          sessionKey: info.sessionKey,
        })),
      });

      // Envia SIGTERM para todos os filhos (graceful)
      for (const pid of pids) {
        killProcessTree(pid, { graceMs: this.killGraceMs });
      }

      // Se for SIGTERM ou SIGINT, schedule SIGKILL nos sobreviventes
      if (signal === "SIGTERM" || signal === "SIGINT") {
        setTimeout(() => {
          for (const pid of pids) {
            try {
              process.kill(pid, 0); // testa se vivo
              killProcessTree(pid, { graceMs: 0 }); // força kill
            } catch {
              // já morreu
            }
          }
        }, this.killGraceMs + 1000).unref();
      }
    };

    process.on("SIGTERM", () => forward("SIGTERM"));
    process.on("SIGINT", () => forward("SIGINT"));
    process.on("SIGHUP", () => forward("SIGHUP"));
    process.on("SIGQUIT", () => forward("SIGQUIT"));
  }

  /**
   * Adiciona um PID ao rastreio.
   */
  track(pid: number, sessionKey: string, kind: "shell" | "job" = "shell"): void {
    if (!Number.isFinite(pid) || pid <= 0) return;
    this.tracked.set(pid, { kind, sessionKey });
  }

  /**
   * Remove um PID do rastreio (quando o filho encerra naturalmente).
   */
  untrack(pid: number): void {
    this.tracked.delete(pid);
  }

  /**
   * Remove todos os PIDs de uma sessionKey.
   */
  untrackBySessionKey(sessionKey: string): void {
    for (const [pid, info] of this.tracked) {
      if (info.sessionKey === sessionKey) {
        this.tracked.delete(pid);
      }
    }
  }

  /** Número de processos atualmente rastreados. */
  get size(): number {
    return this.tracked.size;
  }
}

/** Singleton global. */
let _globalBridge: ChildProcessBridge | null = null;

export function getGlobalChildProcessBridge(killGraceMs = 3_000): ChildProcessBridge {
  if (!_globalBridge) {
    _globalBridge = new ChildProcessBridge(killGraceMs);
    _globalBridge.register();
  }
  return _globalBridge;
}
