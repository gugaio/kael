# Arquitetura - Fase 8.4 (Reconciliacao Automatica de Steps)

Status: concluida (baseline)

Objetivo:
- Sincronizar automaticamente status de steps `in_progress` com estado final de `job/exec` associado.

Entregas:
- `PlannerService.reconcile()`:
  - varre planos ativos (ou plano especifico);
  - identifica steps `in_progress` com `execution`;
  - consulta runtime (`job` ou `exec`);
  - atualiza step para `completed`/`failed`/`canceled` quando houver estado final;
  - registra checkpoint + nota de reconciliacao.
- Reconciliacao automatica em background:
  - novo schedule persistente `planner.reconcile` (`type=planner_reconcile`);
  - executado pelo `PersistentScheduler`.
- Configuracao:
  - `KAEL_PLANNER_RECONCILE_ENABLED` (default `true`);
  - `KAEL_PLANNER_RECONCILE_INTERVAL_MS` (default `5000`).
- Operacao manual:
  - API `POST /plans/reconcile`;
  - tool PI `plan_reconcile`.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/app.ts`
- `src/config.ts`
- `src/global-config.ts`
- `src/api/server.ts`
- `src/engine/pi-tools.ts`

Proximo passo:
- Fase 8.5: reduzir polling com stream/eventos (SSE) para update de plano em baixa latencia.
