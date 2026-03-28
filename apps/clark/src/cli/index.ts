#!/usr/bin/env node
import { Command } from 'commander';

import { runCapabilitiesCommand } from './commands/capabilities.js';
import { runDaemonCommand } from './commands/daemon.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runStatusCommand } from './commands/status.js';

const program = new Command();

program
  .name('clark')
  .description('Clark runtime satelite de capacidades de ambiente para o Kael')
  .version('0.1.0');

program
  .command('daemon')
  .description('Inicia o daemon local e conecta ao servidor remoto')
  .action(async () => {
    await runDaemonCommand();
  });

program
  .command('status')
  .description('Mostra a configuracao efetiva do client')
  .action(() => {
    runStatusCommand();
  });

program
  .command('capabilities')
  .description('Lista as capabilities registradas no client')
  .action(async () => {
    await runCapabilitiesCommand();
  });

program
  .command('doctor')
  .description('Valida configuracao, conectividade e providers MCP do client')
  .action(async () => {
    await runDoctorCommand();
  });

await program.parseAsync(process.argv);
