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

export class SimpleCommandEngine implements AgentEngine {
  async runTurn(input: EngineTurnInput): Promise<EngineTurnOutput> {
    const parsed = parseCommand(input.message);

    if (!parsed) {
      return {
        reply:
          "Comando nao reconhecido. Use /help para ver comandos. Este engine e um bootstrap ate plugar o provider LLM.",
      };
    }

    if (parsed.name === "/help") {
      return {
        reply:
          "Comandos: /transcode <input> <output> | /jobs | /help. Exemplo: /transcode ./input.mp4 ./output.mp4",
      };
    }

    if (parsed.name === "/jobs") {
      const jobs = input.tooling.listJobs().slice(0, 5);
      if (jobs.length === 0) {
        return { reply: "Nenhum job encontrado." };
      }

      const summary = jobs
        .map((job) => `- ${job.id} | ${job.status} | ${job.outputPath}`)
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

      return {
        reply: `Transcode iniciado. jobId=${job.id} status=${job.status} output=${job.outputPath}`,
      };
    }

    return { reply: "Comando desconhecido. Use /help." };
  }
}
