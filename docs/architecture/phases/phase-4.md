# Arquitetura - Fase 4 (Autonomia)

Status: em andamento

## Objetivo

Adicionar autonomia operacional inicial com heartbeat produtivo e agendamento persistente.

## Entregas implementadas (incremento atual)

- Scheduler persistente em JSON:
  - `src/automation/persistent-scheduler.ts`
  - store em `dataDir/automation/scheduler-jobs.json`
- Catch-up basico apos restart:
  - se `nextRunAt` ja passou, executa no proximo tick e recalcula proximo horario.
- Heartbeat runner inicial:
  - `src/automation/heartbeat-runner.ts`
  - monitora mudancas de status de jobs e registra notificacao relevante na sessao (`role: system`).
- Integracao no bootstrap:
  - `src/app.ts` inicia scheduler + job `heartbeat.main`.
- Scheduler com dois modos de agenda:
  - intervalo em ms
  - cron expression (5 campos)
- API de gerenciamento de schedules:
  - `GET /schedules`
  - `GET /schedules/:scheduleId`
  - `POST /schedules` (upsert interval/cron)
  - `POST /schedules/:scheduleId/pause`
  - `POST /schedules/:scheduleId/resume`
- CLI de gerenciamento:
  - `schedules`
  - `schedule-upsert`
  - `schedule-pause`
  - `schedule-resume`

## Comportamento atual

1. App sobe e inicializa scheduler persistente.
2. Job `heartbeat.main` roda por intervalo configuravel.
3. Heartbeat compara snapshot de jobs com estado atual.
4. Quando job muda para `succeeded` ou `failed`, cria mensagem de sistema na sessao do job.
5. Sem mudancas relevantes, heartbeat segue silencioso.

## Limites atuais

- Notificacao e apenas em transcript de sessao (sem canais externos).
- Parser cron intencionalmente simples (`*`, `*/n` e valor exato por campo).

## Proximos incrementos recomendados

- Suportar cron expressions persistentes.
- Expor endpoints/CLI para listar e gerenciar schedules.
- Permitir rotas de notificacao (ex.: webhook/canal dedicado).
