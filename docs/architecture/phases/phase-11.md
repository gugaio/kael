# Arquitetura - Fase 11 (Reply Orchestrator Lite)

Status: concluida

## Objetivo

Introduzir uma camada leve de orquestracao de reply para manter comandos operacionais deterministicos,
mesmo quando o engine principal estiver em modo `pi`.

## Escopo inicial

- Fast-path de slash commands no `ChatService`:
  - bypass do turno LLM para comandos operacionais (`/jobs`, `/probe`, `/transcode`, etc.);
  - execucao direta via `SimpleCommandEngine` usando as tools locais.
- Preservar fluxos especiais existentes:
  - `/compact` continua no fluxo do `MemoryOrchestrator`;
  - comandos operacionais de video/sistema passam pelo mesmo fast-path deterministico de slash commands.

## Valor arquitetural

- Reduz latencia e variabilidade para operacoes repetitivas.
- Evita degradacao de UX quando o modelo nao segue formato de comando.
- Aproxima o Kael de um "auto-reply" pragmatico sem acoplar multi-canal agora.
- Refactor posterior consolidou `tooling factory` fora do `ChatService`, reduzindo acoplamento.
- Contrato `ShellRuntime` introduzido para preparar migracao de `exec/process` para supervisor dedicado (Fase 12).

## Limites desta fase

- Sem fila inbound dedicada por `sessionKey`.
- Sem roteamento multi-channel.
- Sem camada extensa de diretivas/policies estilo OpenClaw.

## Proximos incrementos recomendados

1. Adicionar dedupe/fila leve por `sessionKey` para reduzir colisao de requests concorrentes.
2. Evoluir telemetria de roteamento para dashboards/alertas operacionais (SSE/health ja expostos).
