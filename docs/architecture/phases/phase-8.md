# Arquitetura - Fase 8 (Memoria Operacional)

Status: concluida (item 1)

Objetivo:
- Dar memoria de longo prazo util ao Kael com persistencia local simples e explicita.

Entregas:
- `MemoryService` local-first em markdown:
  - `MEMORY.md` para memoria duravel;
  - `memory/YYYY-MM-DD.md` para memoria diaria.
- Tools no PI:
  - `memory_search` (snippets com path/linhas)
  - `memory_get` (leitura segura de trechos)
  - `memory_write` (persistencia explicita em daily/long_term)
- Regras de seguranca:
  - `memory_get` restringe leitura a `MEMORY.md` e `memory/*.md` dentro do workspace.
- Testes unitarios:
  - escrita daily/long-term
  - busca por snippet
  - bloqueio de path fora da area de memoria

Arquivos-chave:
- `src/memory/service.ts`
- `src/engine/pi-tools.ts`
- `src/chat/service.ts`
- `src/app.ts`
- `src/memory/service.test.ts`

Proximo passo:
- Fase 8.1: planner/executor explicito com estado persistido de plano.
