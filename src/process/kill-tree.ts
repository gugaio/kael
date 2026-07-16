import fs from "node:fs";
import { kaelLogger } from "../infra/logger.js";

const DEFAULT_GRACE_MS = 3_000;
const MAX_GRACE_MS = 60_000;

/**
 * Terminação de árvore de processos com graceful shutdown (POSIX).
 *
 * Envia SIGTERM ao process group (-pid), aguarda grace period,
 * depois SIGKILL se o processo ainda estiver vivo.
 * O timer usa `.unref()` para não bloquear a saída do event loop.
 */
/**
 * Verifica se um PID ainda é o mesmo processo original.
 * Lê /proc/<pid>/stat no Linux/macOS para comparar starttime.
 * Retorna true se o PID não existe mais ou se o starttime não corresponde.
 *
 * Quando não é possível verificar (Windows, permissão), retorna false
 * (assume que o PID é válido).
 */
export function isPidRecycled(pid: number, expectedStartTime?: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return true;
  if (expectedStartTime === undefined) return false; // não tem referência

  try {
    // Testa se o PID está vivo
    process.kill(pid, 0);
  } catch {
    return true; // não existe mais
  }

  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
    // O campo starttime (22º campo em /proc/pid/stat) representa
    // o tick do kernel quando o processo foi criado.
    const fields = stat.match(/\(.*?\)|\S+/g);
    if (!fields || fields.length < 22) return false;
    const starttime = Number(fields[21]);
    if (!Number.isFinite(starttime)) return false;
    if (starttime !== expectedStartTime) {
      kaelLogger.warn("pid.recycled", { pid, expectedStartTime, actualStartTime: starttime });
      return true; // PID foi reciclado
    }
    return false; // mesmo processo
  } catch {
    // Sem /proc (macOS, Windows) — não consegue verificar
    return false;
  }
}

/**
 * Lê o starttime de um PID do /proc. Retorna undefined se não disponível.
 */
export function readPidStartTime(pid: number): number | undefined {
  if (!Number.isFinite(pid) || pid <= 0) return undefined;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
    const fields = stat.match(/\(.*?\)|\S+/g);
    if (fields && fields.length >= 22) {
      return Number(fields[21]);
    }
  } catch {
    // /proc indisponível
  }
  return undefined;
}

export function killProcessTree(pid: number, opts?: { graceMs?: number }): void {
  if (!Number.isFinite(pid) || pid <= 0) {
    return;
  }

  const graceMs = clampGrace(opts?.graceMs);
  killTreeUnix(pid, graceMs);
}

function clampGrace(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_GRACE_MS;
  }
  return Math.max(0, Math.min(MAX_GRACE_MS, Math.floor(value)));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTreeUnix(pid: number, graceMs: number): void {
  // Tenta SIGTERM no process group (pid negativo = pgid)
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Group não existe ou sem permissão — tenta direto
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return; // já encerrou
    }
  }

  if (graceMs === 0) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // já encerrou
      }
    }
    return;
  }

  // Aguarda grace period, depois força SIGKILL
  setTimeout(() => {
    if (isAlive(-pid)) {
      try {
        process.kill(-pid, "SIGKILL");
        return;
      } catch {
        // cai para kill direto
      }
    }
    if (!isAlive(pid)) {
      return;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // processo encerrou entre o check e o kill
    }
  }, graceMs).unref();
}
