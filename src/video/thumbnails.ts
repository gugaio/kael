import fs from "node:fs/promises";
import path from "node:path";
import { LocalProcessRunner, type ProcessRunner } from "../process/runner.js";

const FFMPEG_TIMEOUT_MS = 20_000;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class StreamThumbnailService {
  constructor(
    private readonly thumbnailsDir: string,
    private readonly runner: ProcessRunner = new LocalProcessRunner(),
  ) {}

  thumbnailPath(originId: string): string {
    return path.join(this.thumbnailsDir, `${originId}.jpg`);
  }

  async ensureThumbnail(params: {
    originId: string;
    rootDir: string;
    playbackPath: string;
  }): Promise<string | null> {
    const cached = this.thumbnailPath(params.originId);
    if (await pathExists(cached)) {
      return cached;
    }
    const playlist = path.join(params.rootDir, params.playbackPath);
    if (!(await pathExists(playlist))) {
      return null;
    }
    await fs.mkdir(this.thumbnailsDir, { recursive: true });
    const tmp = `${cached}.tmp-${process.pid}-${Date.now()}.jpg`;
    const ok = await this.runFfmpeg([
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", playlist,
      "-vf", "thumbnail,scale=640:-2",
      "-frames:v", "1",
      tmp,
    ]);
    if (!ok || !(await pathExists(tmp))) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      return null;
    }
    await fs.rename(tmp, cached);
    return cached;
  }

  async removeThumbnail(originId: string): Promise<void> {
    await fs.rm(this.thumbnailPath(originId), { force: true }).catch(() => undefined);
  }

  private runFfmpeg(args: string[]): Promise<boolean> {
    const child = this.runner.spawn("ffmpeg", args).process;
    child.stdin.end();
    child.stdout.resume();
    child.stderr.resume();
    let settled = false;
    return new Promise((resolve) => {
      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(exitCode === 0);
      };
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish(null);
      }, FFMPEG_TIMEOUT_MS);
      timeout.unref();
      child.on("error", () => finish(null));
      child.on("close", finish);
    });
  }
}
