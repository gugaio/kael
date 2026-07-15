const DEFAULT_GRACE_MS = 3_000;
const MAX_GRACE_MS = 60_000;

/**
 * Terminação de árvore de processos com graceful shutdown (POSIX).
 *
 * Envia SIGTERM ao process group (-pid), aguarda grace period,
 * depois SIGKILL se o processo ainda estiver vivo.
 * O timer usa `.unref()` para não bloquear a saída do event loop.
 */
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
