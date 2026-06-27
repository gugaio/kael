import { Command } from "commander";
import { registerApiCommands } from "./api-commands.js";
import { registerCoreCommands } from "./core-commands.js";
import { registerStreamerCommands } from "./streamer-commands.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("kael")
    .description("Kael CLI")
    .showHelpAfterError("(use --help for usage)");

  registerCoreCommands(program);
  registerApiCommands(program);

  registerStreamerCommands(program);

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
