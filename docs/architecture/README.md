# Arquitetura por Fase - Kael

Esta pasta descreve a evolucao arquitetural do Kael de forma incremental.

## Fases

- `docs/architecture/phases/phase-1.md` - Core Loop (CLI + API + sessao + job basico)
- `docs/architecture/phases/phase-2.md` - Engine hibrida + runtime de video expandido
- `docs/architecture/phases/phase-3.md` - Resiliencia operacional
- `docs/architecture/phases/phase-4.md` - Autonomia (heartbeat + scheduler persistente)
- `docs/architecture/phases/phase-5.md` - Hardening e observabilidade operacional
- `docs/architecture/phases/phase-6.md` - Shell tools no PI (exec/process + policy/approvals)

## Como usar

1. Ler da fase menor para a maior.
2. Tratar cada fase como baseline para a proxima.
3. Atualizar o documento da fase sempre que houver mudanca estrutural relevante.
