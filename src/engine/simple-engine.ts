import type { AgentEngine, EngineTurnInput, EngineTurnOutput } from "./types.js";

function parseCommand(message: string): { name: string; args: string[] } | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  const [name, ...args] = parts;
  return { name: name.toLowerCase(), args };
}

export function isSlashCommand(message: string): boolean {
  return message.trim().startsWith("/");
}

function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S+/i);
  if (!match?.[0]) {
    return null;
  }
  return match[0].trim().replace(/[),.;]+$/, "");
}

export class SimpleCommandEngine implements AgentEngine {
  async runTurn(input: EngineTurnInput): Promise<EngineTurnOutput> {
    const parsed = parseCommand(input.message);

    if (!parsed) {
      return {
        reply:
          "Mensagem recebida. Para comandos de video use /help. Para conversa natural, ative KAEL_ENGINE_MODE=pi ou hybrid com chave da API.",
      };
    }

    if (parsed.name === "/help") {
      return {
        reply:
          "Comandos: /transcode <input> <output> | /hls <input> <playlist.m3u8> [segmentSeconds] | /capture <url> <output> [durationSeconds] | /probe <input> | /vlc <input|url> | /jobs | /help",
      };
    }

    if (parsed.name === "/jobs") {
      const jobs = input.tooling.listJobs().slice(0, 8);
      if (jobs.length === 0) {
        return { reply: "Nenhum job encontrado." };
      }

      const summary = jobs
        .map((job) => `- ${job.id} | ${job.type} | ${job.status} | ${job.output ?? "(sem output)"}`)
        .join("\n");

      return { reply: `Ultimos jobs:\n${summary}` };
    }

    if (parsed.name === "/transcode") {
      if (parsed.args.length < 2) {
        return { reply: "Uso: /transcode <input> <output>" };
      }

      const [inputPath, outputPath] = parsed.args;
      const job = await input.tooling.startTranscode({
        sessionKey: input.sessionKey,
        inputPath,
        outputPath,
      });
      return { reply: `Transcode iniciado. jobId=${job.id}` };
    }

    if (parsed.name === "/hls") {
      if (parsed.args.length < 2) {
        return { reply: "Uso: /hls <input> <playlist.m3u8> [segmentSeconds]" };
      }
      const [inputPath, outputPlaylistPath, segmentRaw] = parsed.args;
      const segmentTime = segmentRaw ? Number(segmentRaw) : undefined;
      const job = await input.tooling.startConvertHls({
        sessionKey: input.sessionKey,
        inputPath,
        outputPlaylistPath,
        segmentTime,
      });
      return { reply: `HLS iniciado. jobId=${job.id}` };
    }

    if (parsed.name === "/capture") {
      if (parsed.args.length < 2) {
        return { reply: "Uso: /capture <streamUrl> <output> [durationSeconds]" };
      }
      const [streamUrl, outputPath, durationRaw] = parsed.args;
      const durationSeconds = durationRaw ? Number(durationRaw) : undefined;
      const job = await input.tooling.startCaptureStream({
        sessionKey: input.sessionKey,
        streamUrl,
        outputPath,
        durationSeconds,
      });
      return { reply: `Capture iniciado. jobId=${job.id}` };
    }

    if (parsed.name === "/probe") {
      if (parsed.args.length < 1) {
        return { reply: "Uso: /probe <input>" };
      }
      const [inputPath] = parsed.args;
      const job = await input.tooling.startProbeMedia({
        sessionKey: input.sessionKey,
        inputPath,
      });
      return { reply: `Probe iniciado. jobId=${job.id}` };
    }

    if (parsed.name === "/vlc" || parsed.name === "/playvlc") {
      const fallbackUrl = extractUrl(input.message);
      const inputTarget = parsed.args[0] ?? fallbackUrl;
      if (!inputTarget) {
        return { reply: "Uso: /vlc <input|url>" };
      }
      if (!input.tooling.startPlayVlc) {
        return { reply: "Tool de VLC indisponivel neste modo." };
      }
      const job = await input.tooling.startPlayVlc({
        sessionKey: input.sessionKey,
        input: inputTarget,
      });
      return { reply: `VLC iniciado. jobId=${job.id}` };
    }

    return { reply: "Comando desconhecido. Use /help." };
  }

  getRuntimeTelemetrySnapshot() {
    return {
      timeouts: 0,
      toolCallsByName: {},
      blockedCallsByTool: {},
    };
  }
}
