# Arquitetura por Fase - Kael

Esta pasta descreve a evolucao arquitetural do Kael de forma incremental.

## Fases

- `docs/architecture/phases/phase-1.md` - Core Loop (CLI + API + sessao + job basico)
- `docs/architecture/phases/phase-2.md` - Engine hibrida + runtime de video expandido
- `docs/architecture/phases/phase-3.md` - Resiliencia operacional
- `docs/architecture/phases/phase-4.md` - Autonomia (heartbeat + scheduler persistente)
- `docs/architecture/phases/phase-5.md` - Hardening e observabilidade operacional
- `docs/architecture/phases/phase-6.md` - Shell tools no PI (exec/process + policy/approvals)
- `docs/architecture/phases/phase-7.md` - Guardrails de loop para tools de shell
- `docs/architecture/phases/phase-8.md` - Memoria operacional (memory_search/get/write)
- `docs/architecture/phases/phase-8.1.md` - Planner/executor baseline com estado persistido de planos
- `docs/architecture/phases/phase-8.2.md` - Planner inteligente inicial (geracao por objetivo + checkpoints)
- `docs/architecture/phases/phase-8.3.md` - Executor assistido (`plan_execute_next`) com vinculo a jobs/exec
- `docs/architecture/phases/phase-8.4.md` - Reconciliacao automatica de steps com runtime (`job/exec`)

## Como usar

1. Ler da fase menor para a maior.
2. Tratar cada fase como baseline para a proxima.
3. Atualizar o documento da fase sempre que houver mudanca estrutural relevante.

## Convencao de Estrutura

- Padrao atual: `feature-first` por dominio (ex.: `src/chat`, `src/planner`, `src/memory`).
- Arquivos de dominio devem ficar juntos (`service`, `store`, `types`, `tests` quando aplicavel).
- Evitar pasta `src/services` generica; usar apenas para utilitarios realmente cross-domain.
