import fs from "node:fs";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { ProcessRunner } from "./runner.js";

export type ProcessSpawnOptions = {
  timeoutMs: number;
  killGraceMs: number;
  logPath: string;
};

export type ProcessResult = {
  exitCode: number | null;
  error?: string;
  timedOut: boolean;
};

export interface ProcessSupervisor {
  spawn(
    command: string,
    args: string[],
    options: ProcessSpawnOptions,
  ): {
    process: ChildProcessByStdio<Writable, Readable, Readable>;
    result: Promise<ProcessResult>;
  };
}

export class LocalProcessSupervisor implements ProcessSupervisor {
  constructor(private readonly runner: ProcessRunner) {}

  spawn(
    command: string,
    args: string[],
    options: ProcessSpawnOptions,
  ): {
    process: ChildProcessByStdio<Writable, Readable, Readable>;
    result: Promise<ProcessResult>;
  } {
    const { process } = this.runner.spawn(command, args);
    let timedOut = false;

    const log = fs.createWriteStream(options.logPath, { flags: "a" });

    const timeout = setTimeout(() => {
      timedOut = true;
      log.write(`\n[timeout] ${String(options.timeoutMs)}ms reached, sending SIGTERM\n`);
      process.kill("SIGTERM");
      const forceHandle = setTimeout(() => {
        if (!process.killed) {
          log.write("[timeout] process still alive, sending SIGKILL\n");
          process.kill("SIGKILL");
        }
      }, options.killGraceMs);
      forceHandle.unref();
    }, options.timeoutMs);
    timeout.unref();

    process.stdout.on("data", (chunk: Buffer) => log.write(chunk));
    process.stderr.on("data", (chunk: Buffer) => log.write(chunk));

    const result = new Promise<ProcessResult>((resolve) => {
      process.on("error", (error: Error) => {
        clearTimeout(timeout);
        log.end(`\n[process-error] ${error.message}\n`);
        resolve({ exitCode: null, error: error.message, timedOut: false });
      });

      process.on("close", (code: number | null) => {
        clearTimeout(timeout);
        const error = timedOut
          ? `job timed out after ${String(options.timeoutMs)}ms`
          : code !== 0
            ? `${command} exited with code ${String(code)}`
            : undefined;
        log.end(`\n[process-${code === null ? "error" : "exit"}] ${error ?? `code=${String(code)}`}\n`);
        resolve({ exitCode: code, error, timedOut });
      });
    });

    return { process, result };
  }
}
