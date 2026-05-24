import { Command } from "commander";
import { createKaelApp } from "../app.js";
import { startApiServer } from "../api/server.js";
import { initKaelHome, resolveKaelHome } from "../global-config.js";
import { DiscordChatOnlyBot } from "../integrations/discord/discord-bot.js";

export function registerCoreCommands(program: Command): void {
  program
    .command("init")
    .description("Inicializa ~/.kael (ou $KAEL_HOME)")
    .option("-f, --force", "sobrescreve config global existente", false)
    .action(async (options: { force: boolean }) => {
      await _commandInit(options.force);
    });

  program
    .command("server")
    .description("Inicia API HTTP local")
    .action(async () => {
      await startApiServer();
    });

  program
    .command("discord-bot")
    .description("Inicia bot Discord (chat-only) usando o core local do Kael")
    .action(async () => {
      // Evita scheduler/email_poll duplicado quando API e Discord rodam em processos separados.
      const app = await createKaelApp({ startAutomation: false, enableEmailPolling: false });
      const bot = DiscordChatOnlyBot.fromEnv(app);
      const stop = async () => {
        await bot.stop().catch(() => undefined);
        process.exit(0);
      };
      process.on("SIGINT", () => {
        void stop();
      });
      process.on("SIGTERM", () => {
        void stop();
      });
      await bot.start();
      console.log("Discord bot conectado (chat-only).");
      // Mantem processo vivo; o WebSocket/Timers sustentam o event loop.
    });
}

async function _commandInit(force: boolean): Promise<void> {
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
