import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type SpawnOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type SpawnedProcess = {
  process: ChildProcessWithoutNullStreams;
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
