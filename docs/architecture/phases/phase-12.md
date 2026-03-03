# Arquitetura - Fase 12 (Supervisor de Execucao Shell)

Status: concluida

## Objetivo

Unificar lifecycle de `exec/process` em uma camada dedicada para aumentar determinismo operacional
em cancelamento, timeout e polling sob carga.

## Entregas realizadas

- Novo modulo `ShellProcessSupervisor` (`src/tools/system/shell-process-supervisor.ts`) como fonte
  de verdade para:
  - transicoes de estado de sessoes de shell;
  - polling/list/log/kill/remove;
  - controle de timeout total e timeout por ausencia de output.
- `ShellToolService` agora delega o lifecycle de execucao ao supervisor e mantem no service apenas:
  - policy/approval/preflight;
  - resolucao de shell/cwd.
- Protecao de corrida em `remove`:
  - sessoes removidas nao retornam no mapa apos `close` tardio do processo.

## Valor arquitetural

- Reduz acoplamento entre policy de seguranca e runtime de processo.
- Cria base para evoluir supervisor com fila/snapshots/versionamento sem alterar contrato `ShellRuntime`.
- Diminui risco de inconsistencias em `process poll/list` apos cancelamento/cleanup.

## Pendencias da fase

1. Evoluir snapshots/versionamento do supervisor para observabilidade de mudancas (pos-fase).
