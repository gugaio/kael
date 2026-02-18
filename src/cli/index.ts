import { startApiServer } from "../api/server.js";
import { loadConfig } from "../config.js";

type Args = {
  command: string;
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    i += 1;
  }

  return { command, flags };
}

function printHelp(): void {
  console.log("Kael CLI");
  console.log("  kael server");
  console.log('  kael chat --message "..." [--session main] [--url http://127.0.0.1:3210]');
  console.log("  kael jobs [--url http://127.0.0.1:3210]");
}

function resolveUrl(flags: Record<string, string | boolean>): string {
  const explicit = typeof flags.url === "string" ? flags.url : undefined;
  if (explicit) {
    return explicit;
  }

  const cfg = loadConfig();
  return `http://${cfg.host}:${cfg.port}`;
}

async function commandChat(flags: Record<string, string | boolean>): Promise<void> {
  const message = typeof flags.message === "string" ? flags.message : "";
  if (!message.trim()) {
    throw new Error("--message is required");
  }

  const sessionKey = typeof flags.session === "string" ? flags.session : "main";
  const url = resolveUrl(flags);

  const response = await fetch(`${url}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey, message }),
  });

  const data = (await response.json()) as { ok: boolean; reply?: string; error?: string };
  if (!response.ok || !data.ok) {
    throw new Error(data.error ?? `chat failed with status ${response.status}`);
  }

  console.log(data.reply ?? "");
}

async function commandJobs(flags: Record<string, string | boolean>): Promise<void> {
  const url = resolveUrl(flags);
  const response = await fetch(`${url}/jobs`);
  const data = (await response.json()) as {
    ok: boolean;
    jobs?: Array<{ id: string; status: string; outputPath: string }>;
    error?: string;
  };

  if (!response.ok || !data.ok) {
    throw new Error(data.error ?? `jobs failed with status ${response.status}`);
  }

  const jobs = data.jobs ?? [];
  if (jobs.length === 0) {
    console.log("Nenhum job encontrado.");
    return;
  }

  for (const job of jobs) {
    console.log(`${job.id} | ${job.status} | ${job.outputPath}`);
  }
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === "server") {
    await startApiServer();
    return;
  }

  if (command === "chat") {
    await commandChat(flags);
    return;
  }

  if (command === "jobs") {
    await commandJobs(flags);
    return;
  }

  printHelp();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Kael error: ${message}`);
  process.exitCode = 1;
});
