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

## Estado atual das fases (resumo rapido)

- Fase 1: concluida.
- Fase 2: concluida (engine hibrida + tools de video).
- Fase 3: em andamento (resiliencia), com retry/fallback/idempotency/context guard ja entregues.
- Proximo incremento recomendado: reset controlado de sessao + observabilidade de turnos.

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
