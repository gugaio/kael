import { Command } from "commander";
import { startApiServer } from "../api/server.js";
import { loadConfig } from "../config.js";
import { initKaelHome, resolveKaelHome } from "../global-config.js";

type UrlOption = {
  url?: string;
};

async function resolveUrl(explicit?: string): Promise<string> {
  if (explicit) {
    return explicit;
  }

  const cfg = await loadConfig();
  return `http://${cfg.host}:${cfg.port}`;
}

async function commandInit(force: boolean): Promise<void> {
  const result = await initKaelHome(force);

  console.log(`Kael home: ${result.kaelHome}`);
  console.log(`Config: ${result.configPath}`);
  if (result.created) {
    console.log("Global config criado/atualizado com sucesso.");
  } else {
    console.log("Global config ja existia. Use --force para sobrescrever.");
  }

  if (!process.env.KAEL_HOME) {
    const expectedHome = resolveKaelHome();
    console.log(`KAEL_HOME ativo: ${expectedHome}`);
  }
}

type ChatOptions = UrlOption & {
  session: string;
};

async function commandChat(message: string, options: ChatOptions): Promise<void> {
  const sessionKey = options.session;
  const url = await resolveUrl(options.url);

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

async function commandJobs(options: UrlOption): Promise<void> {
  const url = await resolveUrl(options.url);
  const response = await fetch(`${url}/jobs`);
  const data = (await response.json()) as {
    ok: boolean;
    jobs?: Array<{ id: string; status: string; type: string; output?: string }>;
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
    console.log(`${job.id} | ${job.type} | ${job.status} | ${job.output ?? "(sem output)"}`);
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("kael")
    .description("Kael CLI")
    .showHelpAfterError("(use --help for usage)");

  program
    .command("init")
    .description("Inicializa ~/.kael (ou $KAEL_HOME)")
    .option("-f, --force", "sobrescreve config global existente", false)
    .action(async (options: { force: boolean }) => {
      await commandInit(options.force);
    });

  program
    .command("server")
    .description("Inicia API HTTP local")
    .action(async () => {
      await startApiServer();
    });

  program
    .command("chat")
    .description("Envia mensagem para /chat")
    .requiredOption("-m, --message <text>", "mensagem do usuario")
    .option("-s, --session <sessionKey>", "chave da sessao", "main")
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(async (options: ChatOptions & { message: string }) => {
      await commandChat(options.message, options);
    });

  program
    .command("jobs")
    .description("Lista jobs")
    .option("-u, --url <url>", "url base da API (ex: http://127.0.0.1:3210)")
    .action(async (options: UrlOption) => {
      await commandJobs(options);
    });

  if (process.argv.slice(2).length === 0) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Kael error: ${message}`);
  process.exitCode = 1;
});
