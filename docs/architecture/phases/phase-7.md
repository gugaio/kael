# Arquitetura - Fase 7 (Guardrails de Loop de Tools)

Status: em andamento

Objetivo:
- Evitar que o agente fique preso em loops de tool calling (`exec`/`process`/`web_*`) sem progresso.

Entregas:
- `ToolLoopGuard` no runtime PI de agents com estado por `sessionKey + tool + assinatura de parametros`.
- Deteccao de repeticao/no-progress com cooldown curto antes de permitir nova chamada.
- Integracao direta nas tools `exec`, `process`, `web_search`, `web_fetch` e `web_research` em `src/agents/pi-tools.ts`.
- No-progress threshold dedicado para web (`web_fetch`/`web_search`) para cortar loops de fetch repetido mais cedo.
- Resposta estruturada ao modelo quando bloqueado (`blocked=true`, `reason`, `retryAfterMs`).
- Testes unitarios do guard (`src/agents/tool-loop-guard.test.ts`).
- Context guard com auto-compaction no `TurnOrchestrator`:
  - detecta explosao de contexto por quantidade de mensagens/chars;
  - injeta resumo persistido como mensagem `system` (`[compaction] ...`);
  - evita compaction repetida em loop (verifica compaction recente);
  - inclui mensagem de compaction no contexto enviado ao runtime de agents.
- Testes unitarios da compaction (`src/chat/turn-orchestrator.test.ts`).

Decisoes:
- Escopo evoluiu de `exec/process` para tambem cobrir loops de pesquisa web sem progresso no mesmo turno.
- Cooldown temporario (nao bloqueio permanente), para manter capacidade de recuperacao automatica.

Proximo passo:
- Evoluir summary heuristico para compaction orientada por LLM (quando fizer sentido de custo/latencia).
