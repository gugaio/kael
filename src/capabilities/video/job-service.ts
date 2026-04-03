import crypto from "node:crypto";
import fs from "node:fs";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { JobStore } from "../../jobs/store.js";
import type { VideoJob, VideoJobType } from "../../types.js";
import { kaelLogger } from "../../infra/logger.js";
import type { ProcessRunner } from "../../tools/system/process-runner.js";
import {
  validateExistingInputPath,
  validateOutputPath,
  validateStreamUrl,
  validateUserArgs,
} from "./safety.js";

type StartJobParams = {
  id: string;
  action: VideoJobType;
  sessionKey: string;
  command: "ffmpeg" | "ffprobe" | "vlc";
  input: string;
  output?: string;
  args: string[];
};

export class VideoJobService {
  private readonly queue: StartJobParams[] = [];
  private readonly activeJobs: Map<string, ChildProcessByStdio<Writable, Readable, Readable>> =
    new Map();
  private readonly canceledJobs: Set<string> = new Set();
  private reservedSlots = 0;

  constructor(
    private readonly jobs: JobStore,
    private readonly runner: ProcessRunner,
    private readonly safety: {
      safePathsEnabled: boolean;
      allowedPaths: string[];
      maxJobArgs: number;
      maxConcurrentJobs: number;
      jobTimeoutMs: number;
      killGraceMs: number;
    },
  ) {}

  getRuntimeStats(): { activeJobs: number; queuedJobs: number; maxConcurrentJobs: number } {
    // Expõe um snapshot simples do runtime para observabilidade: jobs já em
    // execução, slots reservados para jobs prestes a spawnar, fila pendente e
    // o teto de concorrência configurado.
    return {
      activeJobs: this.activeJobs.size + this.reservedSlots,
      queuedJobs: this.queue.length,
      maxConcurrentJobs: this.safety.maxConcurrentJobs,
    };
  }

  async startTranscode(params: {
    sessionKey: string;
    inputPath: string;
    outputPath: string;
    args?: string[];
  }): Promise<VideoJob> {
    // Agenda um transcode assíncrono com ffmpeg: valida origem/destino e monta
    // `ffmpeg -y -i <input> ... <output>`. Sem args customizados, o método
    // reencoda vídeo para H.264 (`libx264`) e áudio para AAC; com args do
    // usuário, apenas repassa os parâmetros validados para o ffmpeg.
    await validateExistingInputPath({
      value: params.inputPath,
      label: "inputPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });
    validateOutputPath({
      value: params.outputPath,
      label: "outputPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });
    const userArgs = validateUserArgs(params.args, this.safety.maxJobArgs);
    const codecArgs = userArgs.length > 0 ? userArgs : ["-c:v", "libx264", "-c:a", "aac"];
    return this.startJob({
      action: "transcode",
      sessionKey: params.sessionKey,
      command: "ffmpeg",
      input: params.inputPath,
      output: params.outputPath,
      args: ["-y", "-i", params.inputPath, ...codecArgs, params.outputPath],
    });
  }

  async startConvertHls(params: {
    sessionKey: string;
    inputPath: string;
    outputPlaylistPath: string;
    segmentTime?: number;
  }): Promise<VideoJob> {
    // Esta capability agenda um job assíncrono de conversão para HLS: valida o
    // arquivo de entrada e o destino da playlist, normaliza `segmentTime` e
    // dispara um ffmpeg em modo remux (`-c copy`) para gerar uma playlist
    // `.m3u8` com segmentos sequenciais a partir de um arquivo local, sem
    // reencodar audio/video.
    await validateExistingInputPath({
      value: params.inputPath,
      label: "inputPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });
    validateOutputPath({
      value: params.outputPlaylistPath,
      label: "outputPlaylistPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });

    const segmentTime = Number.isFinite(params.segmentTime) && (params.segmentTime ?? 0) > 0
      ? Math.floor(params.segmentTime ?? 10)
      : 10;

    return this.startJob({
      action: "convert_hls",
      sessionKey: params.sessionKey,
      command: "ffmpeg",
      input: params.inputPath,
      output: params.outputPlaylistPath,
      args: [
        "-y",
        "-i",
        params.inputPath,
        "-c",
        "copy",
        "-start_number",
        "0",
        "-hls_time",
        String(segmentTime),
        "-hls_list_size",
        "0",
        "-f",
        "hls",
        params.outputPlaylistPath,
      ],
    });
  }

  async startCaptureStream(params: {
    sessionKey: string;
    streamUrl: string;
    outputPath: string;
    durationSeconds?: number;
  }): Promise<VideoJob> {
    // Agenda a captura de um stream remoto com `ffmpeg -i <url> [-t N] -c copy
    // <output>`. O ffmpeg lê a origem HTTP/HTTPS, opcionalmente limita a
    // gravação pela duração pedida e remuxa o conteúdo para arquivo sem
    // reencodar, preservando os codecs de entrada quando possível.
    validateStreamUrl(params.streamUrl);
    validateOutputPath({
      value: params.outputPath,
      label: "outputPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });

    const durationArgs =
      Number.isFinite(params.durationSeconds) && (params.durationSeconds ?? 0) > 0
        ? ["-t", String(Math.min(21600, Math.floor(params.durationSeconds ?? 0)))]
        : [];

    return this.startJob({
      action: "capture_stream",
      sessionKey: params.sessionKey,
      command: "ffmpeg",
      input: params.streamUrl,
      output: params.outputPath,
      args: ["-y", "-i", params.streamUrl, ...durationArgs, "-c", "copy", params.outputPath],
    });
  }

  async startProbeMedia(params: {
    sessionKey: string;
    inputPath: string;
  }): Promise<VideoJob> {
    // Agenda um probe local com ffprobe em modo somente-inspeção: o comando
    // silencia logs não críticos (`-v error`) e retorna JSON com metadados de
    // container e streams, como duração, bitrate, codec, resolução e frame
    // rate médio, sem alterar o arquivo de origem.
    await validateExistingInputPath({
      value: params.inputPath,
      label: "inputPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });
    return this.startJob({
      action: "probe_media",
      sessionKey: params.sessionKey,
      command: "ffprobe",
      input: params.inputPath,
      args: [
        "-v",
        "error",
        "-show_entries",
        "format=duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,avg_frame_rate",
        "-of",
        "json",
        params.inputPath,
      ],
    });
  }

  async startProbeUrl(params: {
    sessionKey: string;
    streamUrl: string;
  }): Promise<VideoJob> {
    // Igual ao probe local, mas apontando o ffprobe para uma URL de stream.
    // Serve para inspecionar um recurso remoto e obter o mesmo JSON resumido de
    // formato/streams sem baixar ou transcodar o conteúdo inteiro.
    validateStreamUrl(params.streamUrl);
    return this.startJob({
      action: "probe_media",
      sessionKey: params.sessionKey,
      command: "ffprobe",
      input: params.streamUrl,
      args: [
        "-v",
        "error",
        "-show_entries",
        "format=duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,avg_frame_rate",
        "-of",
        "json",
        params.streamUrl,
      ],
    });
  }

  async startPlayVlc(params: {
    sessionKey: string;
    input: string;
  }): Promise<VideoJob> {
    // Agenda a abertura do VLC com um único argumento de entrada. O método
    // aceita arquivo local ou URL HTTP/HTTPS, valida a origem e delega ao job
    // runner a execução do player como processo externo do sistema.
    const value = params.input.trim();
    if (!value) {
      throw new Error("input is required");
    }
    if (/^https?:\/\//i.test(value)) {
      validateStreamUrl(value);
    } else {
      await validateExistingInputPath({
        value,
        label: "input",
        allowedRoots: this.safety.allowedPaths,
        safePathsEnabled: this.safety.safePathsEnabled,
      });
    }

    return this.startJob({
      action: "play_vlc",
      sessionKey: params.sessionKey,
      command: "vlc",
      input: value,
      args: [value],
    });
  }

  async cancelJob(jobId: string): Promise<{ job: VideoJob | null; canceled: boolean }> {
    // Cancela um job em qualquer estágio: remove imediatamente da fila se ainda
    // não executou, ou sinaliza o processo ativo com SIGTERM e agenda SIGKILL
    // após a janela de graça para evitar processos órfãos.
    const job = this.jobs.get(jobId);
    if (!job) {
      return { job: null, canceled: false };
    }

    const queuedIndex = this.queue.findIndex((item) => item.id === jobId);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      const updated = await this.jobs.update(jobId, {
        status: "canceled",
        endedAt: new Date().toISOString(),
        error: "job canceled by user",
      });
      return { job: (updated ?? this.jobs.get(jobId)) as VideoJob | null, canceled: true };
    }

    const running = this.activeJobs.get(jobId);
    if (!running) {
      return { job: this.jobs.get(jobId) as VideoJob | null, canceled: false };
    }

    this.canceledJobs.add(jobId);
    running.kill("SIGTERM");
    const forceHandle = setTimeout(() => {
      if (!running.killed) {
        running.kill("SIGKILL");
      }
    }, this.safety.killGraceMs);
    forceHandle.unref();

    return { job: this.jobs.get(jobId) as VideoJob | null, canceled: true };
  }

  private async startJob(params: Omit<StartJobParams, "id">): Promise<VideoJob> {
    // Materializa o job persistido com status inicial `queued`, registra o
    // caminho de log e o coloca na fila interna; a execução real acontece
    // depois via `drainQueue`, respeitando o limite de concorrência.
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const initial: VideoJob = {
      id,
      capability: "video",
      action: params.action,
      sessionKey: params.sessionKey,
      command: params.command,
      input: params.input,
      output: params.output,
      args: params.args,
      status: "queued",
      createdAt,
      logPath: this.jobs.getLogPath(id),
    };

    await this.jobs.create(initial);
    this.queue.push({ ...params, id });
    this.drainQueue();

    return initial;
  }

  private drainQueue(): void {
    // Consome a fila enquanto houver capacidade. `reservedSlots` evita corrida
    // entre remover da fila e o processo efetivamente entrar em `activeJobs`,
    // mantendo a concorrência real dentro do limite configurado.
    while (this.activeJobs.size + this.reservedSlots < this.safety.maxConcurrentJobs) {
      const next = this.queue.shift();
      if (!next) {
        return;
      }
      this.reservedSlots += 1;
      void this.executeJob(next);
    }
  }

  private async executeJob(params: StartJobParams): Promise<void> {
    // Executa o comando do job, anexa stdout/stderr ao log persistente e faz o
    // lifecycle completo de status: `running`, sucesso, falha, cancelamento ou
    // timeout. O timeout primeiro tenta SIGTERM e só força SIGKILL se o
    // processo não encerrar dentro de `killGraceMs`.
    try {
      await this.jobs.update(params.id, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      const { process } = this.runner.spawn(params.command, params.args);
      this.activeJobs.set(params.id, process);
      this.reservedSlots = Math.max(0, this.reservedSlots - 1);
      const logStream = fs.createWriteStream(this.jobs.getLogPath(params.id), { flags: "a" });

      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        logStream.write(`\n[timeout] ${String(this.safety.jobTimeoutMs)}ms reached, sending SIGTERM\n`);
        process.kill("SIGTERM");
        const forceHandle = setTimeout(() => {
          if (!process.killed) {
            logStream.write("[timeout] process still alive, sending SIGKILL\n");
            process.kill("SIGKILL");
          }
        }, this.safety.killGraceMs);
        forceHandle.unref();
      }, this.safety.jobTimeoutMs);
      timeoutHandle.unref();

      process.stdout.on("data", (chunk) => {
        logStream.write(chunk);
      });
      process.stderr.on("data", (chunk) => {
        logStream.write(chunk);
      });

      process.on("error", async (error) => {
        clearTimeout(timeoutHandle);
        this.activeJobs.delete(params.id);
        const canceled = this.canceledJobs.has(params.id);
        this.canceledJobs.delete(params.id);
        await this.jobs.update(params.id, {
          status: canceled ? "canceled" : "failed",
          endedAt: new Date().toISOString(),
          error: canceled ? "job canceled by user" : error.message,
        });
        logStream.end(`\n[process-error] ${error.message}\n`);
        kaelLogger.error("jobs.execution.failed", {
          jobId: params.id,
          type: params.action,
          reason: canceled ? "canceled_process_error" : "process_error",
          message: error.message,
        });
        this.drainQueue();
      });

      process.on("close", async (code) => {
        clearTimeout(timeoutHandle);
        this.activeJobs.delete(params.id);
        const canceled = this.canceledJobs.has(params.id);
        this.canceledJobs.delete(params.id);
        await this.jobs.update(params.id, {
          status: canceled ? "canceled" : code === 0 && !timedOut ? "succeeded" : "failed",
          endedAt: new Date().toISOString(),
          exitCode: code,
          error:
            canceled
              ? "job canceled by user"
              : code === 0 && !timedOut
              ? undefined
              : timedOut
                ? `job timed out after ${String(this.safety.jobTimeoutMs)}ms`
                : `${params.command} exited with code ${String(code)}`,
        });
        logStream.end(`\n[process-exit] code=${String(code)}\n`);

        kaelLogger.info("jobs.execution.finished", {
          jobId: params.id,
          type: params.action,
          exitCode: code,
          timedOut,
          canceled,
        });
        this.drainQueue();
      });
    } catch (error) {
      this.reservedSlots = Math.max(0, this.reservedSlots - 1);
      await this.jobs.update(params.id, {
        status: "failed",
        endedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      kaelLogger.error("jobs.execution.failed", {
        jobId: params.id,
        type: params.action,
        reason: "setup_error",
        message: error instanceof Error ? error.message : String(error),
      });
      this.drainQueue();
    }
  }
}
