# Arquitetura - Fase 8.3 (Executor Assistido de Plano)

Status: concluida (baseline)

Objetivo:
- Permitir que o Kael execute o proximo step do plano usando runtime real (`jobs`/`exec`) e registre vinculo operacional no step.

Entregas:
- `PlannerService.executeNext()`:
  - resolve o proximo step (`pending`/`in_progress`);
  - infere acao por heuristica (`probe`, `capture`, `transcode`, `hls`, `exec`, `manual`);
  - valida inputs obrigatorios e bloqueia step quando faltam parametros;
  - dispara runtime correspondente via callbacks;
  - marca step como `in_progress` com `execution` (`kind`, `refId`, `status`, `startedAt`);
  - em falha de dispatch, marca step como `failed` com checkpoint/nota.
- Normalizacao de planos legados no `init()`:
  - garante `checkpoints` mesmo em dados antigos sem esse campo.
- Integracao no PI:
  - nova tool `plan_execute_next`.
- API HTTP:
  - `POST /plans/:planId/execute-next`.
- Testes:
  - unitarios do planner cobrindo dispatch bem-sucedido e bloqueio por input ausente;
  - integracao da API cobrindo endpoint de execucao do proximo step.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/agents/pi-tools.ts`
- `src/agents/types.ts`
- `src/chat/service.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`

Proximo passo:
- Fase 8.5: reduzir polling com stream/eventos (SSE) para update de plano em baixa latencia.
