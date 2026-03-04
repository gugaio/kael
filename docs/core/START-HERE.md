# START HERE - Kael

Indice rapido para humanos e onboarding inicial.

## Fonte principal de instrucoes

- `AGENTS.md` (principal e obrigatorio)

## Contexto e estrategia

- `docs/core/SOUL.md`
- `docs/planning/PROJECT-VISION.md`
- `docs/planning/AGENT-DEV-GUIDE.md`
- `docs/planning/PROJECT-STATUS.md`
- `docs/architecture/README.md`
- `docs/ui/UI-GUIDE.md`
- `docs/how-jobs-and-heartbeat-work.md` (guia de jobs + heartbeat)

## Estado atual das fases (resumo rapido)

- Fase 1: concluida.
- Fase 2: em andamento (engine hibrida + tools de video concluidos; faltam testes automatizados das tools).
- Fase 3: concluida (resiliencia operacional).
- Fase 4: concluida (autonomia: heartbeat + scheduler persistente + schedules API/CLI).
- Fase 5: concluida (hardening: observabilidade + seguranca de execucao de jobs).
- Fase 6: concluida (shell tools no PI: `exec` + `process` + `exec-approvals`).
- Fase 6.1: concluida (approvals end-to-end: API + CLI + UI).
- Fase 7: concluida (guardrails de loop + compaction de contexto).
- Fase 8.0: concluida (memoria operacional com `memory_search/get/write`).
- Fase 8.1: concluida (planner/executor baseline com planos persistidos).
- Fase 8.2: concluida (planner inteligente inicial com `plan_generate` e checkpoints por etapa).
- Fase 8.3: concluida (executor assistido com `plan_execute_next` e vinculo de execucao no step).
- Fase 8.4: concluida (reconciliacao automatica de steps com status final de `job/exec`).
- Fase 9.1: concluida (research API-first com `web_search`, Tavily e memoria por sessao).
- Fase 9.2: concluida (enriquecimento por URL com `web_fetch`, extracao de texto e cache TTL).
- Fase 9.3: concluida (sintese multi-fonte com `web_research` e score de confianca).
- Fase 9.4: concluida (hardening + ranking de evidencia/confianca em `web_fetch`/`web_research`).
- Fase 10.0: concluida (compaction manual/auto + memory flush + promocao para `MEMORY.md` + dedupe semantica basica).
- Fase 11: concluida (reply orchestrator lite com fast-path deterministico + roteador dedicado + telemetria de rota).
- Fase 12: concluida (supervisor dedicado para lifecycle de `exec/process` + testes de corrida baseline).
- Fase 14: em andamento (email ingress MVP via provider desacoplado + polling POP3 Gmail).
- Fase 15: em andamento (multimodal ingress MVP: anexos imagem/audio no fluxo core).

## Estudos e referencias tecnicas

- `docs/research/study.md`
- `docs/research/openclaw-interesting-patterns.md`
- `docs/research/openclaw-pi-agent-architecture.md`
- `docs/research/gateway-send-flow.md`
- OpenClaw: `/home/gugaime/IA/openclaw`
- Thesis: `/home/gugaime/IA/thesis`

## Comandos rapidos

```bash
npm install
npm run check
npx tsx src/cli/index.ts server
npx tsx src/cli/index.ts chat --message "/help"
npx tsx src/cli/index.ts jobs
```
