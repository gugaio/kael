import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { sanitizeHostEnv } from "../security/host-env-security.js";

export type SpawnOptions = {
  cwd?: string;
  /** Variáveis de ambiente extras a mesclar (validadas pelo chamador). */
  env?: NodeJS.ProcessEnv;
  /** Chaves adicionais a bloquear além da denylist padrão. */
  envDenylistExtra?: ReadonlyArray<string>;
};

export type SpawnedProcess = {
  process: ChildProcessByStdio<Writable, Readable, Readable>;
};

export interface ProcessRunner {
  spawn(command: string, args: string[], options?: SpawnOptions): SpawnedProcess;
}

export class LocalProcessRunner implements ProcessRunner {
  spawn(command: string, args: string[], options: SpawnOptions = {}): SpawnedProcess {
    // Sanitiza o env herdado antes de mesclar variáveis do chamador,
    // evitando que LD_PRELOAD, BASH_ENV, NODE_OPTIONS etc. vazem para subprocessos.
    const baseEnv = sanitizeHostEnv(process.env, options.envDenylistExtra);
    const env = options.env ? { ...baseEnv, ...options.env } : baseEnv;

    // detached:true cria um novo process group, permitindo matar
    // a árvore inteira via kill(-pgid).
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    // Evitar que o processo filho segure o event loop do pai
    child.unref();

    return { process: child };
  }
}
