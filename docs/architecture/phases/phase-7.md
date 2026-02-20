# Arquitetura - Fase 7 (Guardrails de Loop de Tools)

Status: concluida (item 1)

Objetivo:
- Evitar que o agente fique preso em loops de tool calling (`exec`/`process`) sem progresso.

Entregas:
- `ToolLoopGuard` no engine PI com estado por `sessionKey + tool + assinatura de parametros`.
- Deteccao de repeticao/no-progress com cooldown curto antes de permitir nova chamada.
- Integracao direta nas tools `exec` e `process` em `src/engine/pi-tools.ts`.
- Resposta estruturada ao modelo quando bloqueado (`blocked=true`, `reason`, `retryAfterMs`).
- Testes unitarios do guard (`src/engine/tool-loop-guard.test.ts`).

Decisoes:
- Escopo inicial limitado a `exec` e `process` (alto risco de loop e custo).
- Cooldown temporario (nao bloqueio permanente), para manter capacidade de recuperacao automatica.

Proximo passo:
- Adicionar guard de contexto + compaction automatica da sessao (item 2).
