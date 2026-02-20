# Arquitetura - Fase 7 (Guardrails de Loop de Tools)

Status: em andamento

Objetivo:
- Evitar que o agente fique preso em loops de tool calling (`exec`/`process`) sem progresso.

Entregas:
- `ToolLoopGuard` no engine PI com estado por `sessionKey + tool + assinatura de parametros`.
- Deteccao de repeticao/no-progress com cooldown curto antes de permitir nova chamada.
- Integracao direta nas tools `exec` e `process` em `src/engine/pi-tools.ts`.
- Resposta estruturada ao modelo quando bloqueado (`blocked=true`, `reason`, `retryAfterMs`).
- Testes unitarios do guard (`src/engine/tool-loop-guard.test.ts`).
- Context guard com auto-compaction no `TurnOrchestrator`:
  - detecta explosao de contexto por quantidade de mensagens/chars;
  - injeta resumo persistido como mensagem `system` (`[compaction] ...`);
  - evita compaction repetida em loop (verifica compaction recente);
  - inclui mensagem de compaction no contexto enviado ao engine.
- Testes unitarios da compaction (`src/services/turn-orchestrator.test.ts`).

Decisoes:
- Escopo inicial limitado a `exec` e `process` (alto risco de loop e custo).
- Cooldown temporario (nao bloqueio permanente), para manter capacidade de recuperacao automatica.

Proximo passo:
- Evoluir summary heuristico para compaction orientada por LLM (quando fizer sentido de custo/latencia).
