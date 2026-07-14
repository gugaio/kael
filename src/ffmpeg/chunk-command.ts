import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { StreamerCloneResult, StreamerClonedSegment } from "@gugaio/vhs";

export type StreamChunkTargetKind = "variant" | "rendition" | "flat";
export type StreamChunkBinary = "ffprobe" | "ffmpeg";

export type StreamChunkCommandInput = {
  origin: StreamerCloneResult;
  targetKind?: StreamChunkTargetKind;
  targetIndex?: number;
  segmentIndex: number;
  binary: StreamChunkBinary;
  args: string[];
  timeoutMs?: number;
  maxOutputChars?: number;
};

export type StreamChunkCommandResult = {
  ok: boolean;
  binary: StreamChunkBinary;
  args: string[];
  commandPreview: string;
  originId: string;
  targetKind: StreamChunkTargetKind;
  targetIndex: number;
  segmentIndex: number;
  chunkPath: string;
  chunk: StreamerClonedSegment;
  outDir: string;
  outPath: string;
  outputFiles: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  error?: string;
};

export class StreamChunkCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamChunkCommandError";
  }
}

type ResolvedChunk = {
  targetKind: StreamChunkTargetKind;
  targetIndex: number;
  segment: StreamerClonedSegment;
  baseDir: string;
};

export async function runStreamChunkCommand(input: StreamChunkCommandInput): Promise<StreamChunkCommandResult> {
  validateBinary(input.binary);
  validateArgs(input.args);
  const resolved = resolveChunk(input);
  const chunkPath = path.resolve(resolved.baseDir, resolved.segment.localUri);
  await assertPathInsideOrigin(input.origin.rootDir, chunkPath);
  await fs.access(chunkPath);

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), `kael-stream-chunk-${input.origin.id}-`));
  const outPath = path.join(outDir, "output");
  const args = input.args.map((arg) =>
    arg
      .replaceAll("{chunk}", chunkPath)
      .replaceAll("{outDir}", outDir)
      .replaceAll("{out}", outPath)
      .replaceAll("{originRoot}", input.origin.rootDir),
  );
  const startedAt = Date.now();
  const timeout = clampTimeout(input.timeoutMs);
  const maxOutputChars = clampOutputChars(input.maxOutputChars);
  const child = spawn(input.binary, args, {
    cwd: outDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return await new Promise<StreamChunkCommandResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const finish = async (params: { exitCode: number | null; error?: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      const outputFiles = await listOutputFiles(outDir);
      resolve({
        ok: params.exitCode === 0 && !params.error && !timedOut,
        binary: input.binary,
        args,
        commandPreview: [input.binary, ...args].join(" "),
        originId: input.origin.id,
        targetKind: resolved.targetKind,
        targetIndex: resolved.targetIndex,
        segmentIndex: input.segmentIndex,
        chunkPath,
        chunk: resolved.segment,
        outDir,
        outPath,
        outputFiles,
        stdout,
        stderr,
        exitCode: params.exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        ...(params.error ? { error: params.error } : {}),
      });
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      void finish({ exitCode: null, error: `timeout:${timeout}` });
    }, timeout);

    child.stdout.on("data", (chunk) => {
      stdout = appendWithCap(stdout, String(chunk), maxOutputChars);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendWithCap(stderr, String(chunk), maxOutputChars);
    });
    child.on("error", (error) => {
      void finish({ exitCode: null, error: error instanceof Error ? error.message : String(error) });
    });
    child.on("close", (code) => {
      void finish({ exitCode: code });
    });
  });
}

function resolveChunk(input: StreamChunkCommandInput): ResolvedChunk {
  const targetKind = input.targetKind ?? "variant";
  const targetIndex = Math.max(0, Math.floor(input.targetIndex ?? 0));
  const segmentIndex = Math.max(0, Math.floor(input.segmentIndex));
  if (!Number.isFinite(segmentIndex)) {
    throw new StreamChunkCommandError("segmentIndex must be finite");
  }

  if (targetKind === "variant") {
    const target = input.origin.variants[targetIndex];
    if (!target) throw new StreamChunkCommandError(`variant not found: ${targetIndex}`);
    const segment = target.segments[segmentIndex];
    if (!segment) throw new StreamChunkCommandError(`segment not found: variant=${targetIndex} segment=${segmentIndex}`);
    return { targetKind, targetIndex, segment, baseDir: path.dirname(target.manifestPath) };
  }

  if (targetKind === "rendition") {
    const target = input.origin.renditions[targetIndex];
    if (!target) throw new StreamChunkCommandError(`rendition not found: ${targetIndex}`);
    const segment = target.segments[segmentIndex];
    if (!segment) throw new StreamChunkCommandError(`segment not found: rendition=${targetIndex} segment=${segmentIndex}`);
    return { targetKind, targetIndex, segment, baseDir: path.dirname(target.manifestPath) };
  }

  const segment = input.origin.segments[segmentIndex];
  if (!segment) throw new StreamChunkCommandError(`segment not found: flat segment=${segmentIndex}`);
  return { targetKind, targetIndex: 0, segment, baseDir: input.origin.rootDir };
}

function validateBinary(binary: string): asserts binary is StreamChunkBinary {
  if (binary !== "ffprobe" && binary !== "ffmpeg") {
    throw new StreamChunkCommandError("binary must be ffprobe or ffmpeg");
  }
}

function validateArgs(args: string[]): void {
  if (!Array.isArray(args) || args.length === 0) {
    throw new StreamChunkCommandError("args are required");
  }
  if (args.length > 120) {
    throw new StreamChunkCommandError("args limit exceeded: max 120");
  }
  for (const arg of args) {
    if (typeof arg !== "string" || !arg.trim()) {
      throw new StreamChunkCommandError("args cannot contain empty values");
    }
    if (/[\u0000-\u001f\u007f]/.test(arg)) {
      throw new StreamChunkCommandError("args cannot contain control characters");
    }
  }
}

async function assertPathInsideOrigin(rootDir: string, filePath: string): Promise<void> {
  const root = path.resolve(rootDir);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new StreamChunkCommandError("resolved chunk path is outside origin root");
  }
}

function clampTimeout(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN) || (value ?? 0) <= 0) {
    return 120_000;
  }
  return Math.min(10 * 60_000, Math.max(1_000, Math.floor(value ?? 120_000)));
}

function clampOutputChars(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN) || (value ?? 0) <= 0) {
    return 120_000;
  }
  return Math.min(1_000_000, Math.max(1_000, Math.floor(value ?? 120_000)));
}

function appendWithCap(current: string, chunk: string, cap: number): string {
  const next = current + chunk;
  return next.length <= cap ? next : next.slice(next.length - cap);
}

async function listOutputFiles(outDir: string): Promise<string[]> {
  const entries = await fs.readdir(outDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(outDir, entry.name))
    .sort();
}
