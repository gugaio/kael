import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export type SpawnOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type SpawnedProcess = {
  process: ChildProcessByStdio<Writable, Readable, Readable>;
};

export interface ProcessRunner {
  spawn(command: string, args: string[], options?: SpawnOptions): SpawnedProcess;
}

export class LocalProcessRunner implements ProcessRunner {
  spawn(command: string, args: string[], options: SpawnOptions = {}): SpawnedProcess {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    return { process: child };
  }
}
