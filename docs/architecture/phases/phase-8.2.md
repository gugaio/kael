# Arquitetura - Fase 8.2 (Planner Inteligente Inicial)

Status: concluida (incremento inicial)

Objetivo:
- Evoluir o planner de CRUD para planejamento assistido por objetivo + checkpoints de progresso por etapa.

Entregas:
- `PlannerService.generate()`:
  - recebe objetivo em linguagem natural;
  - deriva passos de execucao por heuristica (video/shell/schedule);
  - cria plano persistido com titulo e passos sugeridos.
- Checkpoints por etapa:
  - cada `PlanStep` agora guarda historico de checkpoints (`at`, `status`, `notes?`);
  - `updateStep` passa a registrar checkpoint em toda transicao;
  - `notes` da etapa passam a acumular historico timestampado.
- Integracao PI:
  - nova tool `plan_generate`.
- API HTTP:
  - `POST /plans/generate` com `sessionKey`, `objective`, `maxSteps?`.
- Testes:
  - unitarios no planner cobrindo geracao por objetivo;
  - integracao API cobrindo endpoint de geracao.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/engine/pi-tools.ts`
- `src/engine/types.ts`
- `src/chat/service.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`

Proximo passo:
- Fase 8.4: reconciliacao automatica de estado (fechar step quando `job/exec` terminar).
