# Arquitetura - Fase 8.1 (Planner/Executor Baseline)

Status: concluida (baseline)

Objetivo:
- Tornar o plano de execucao um objeto explicito e persistido (nao so texto em chat).

Entregas:
- `PlannerService` com persistencia local em `plans/plans.json`.
- Modelo de plano:
  - `ExecutionPlan` (`id`, `sessionKey`, `title`, `status`, `steps`, timestamps).
  - `PlanStep` (`id`, `title`, `status`, `notes`, `updatedAt`).
- Operacoes basicas:
  - criar plano com etapas;
  - listar/filtrar planos;
  - buscar plano por id;
  - atualizar status de etapa;
  - consultar proxima acao (`pending`/`in_progress`).
- Integracao no PI via tools:
  - `plan_create`
  - `plan_list`
  - `plan_update_step`
  - `plan_next`
- API HTTP para planos:
  - `GET /plans`
  - `GET /plans/:planId`
  - `POST /plans`
  - `POST /plans/:planId/steps/:stepIndex`
- Testes unitarios cobrindo create/list, transicao de status e next action.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/engine/types.ts`
- `src/engine/pi-tools.ts`
- `src/chat/service.ts`
- `src/app.ts`
- `src/api/server.ts`

Proximo passo:
- Fase 8.3: executor assistido (vincular steps com jobs/processos e atualizar checkpoints automaticamente).
