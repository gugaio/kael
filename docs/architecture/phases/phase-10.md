# Arquitetura - Fase 10 (Compaction + Memory Flush)

Status: concluida (baseline)

Objetivo:
- Tornar a compactacao de contexto um fluxo explicito, observavel e testavel.
- Persistir memoria util antes da compactacao (daily + promocao opcional para longo prazo).
- Preparar base para curadoria de memoria com menos duplicacao.

Entregas (ate agora):
- `MemoryOrchestrator` como camada de orquestracao entre chat, memoria e compaction.
- Comando manual `/compact` no chat:
  - dispara `daily flush`;
  - tenta promocao para `MEMORY.md`;
  - executa compactacao imediata via `TurnOrchestrator.compactNow()`;
  - retorna status estruturado (`flush`, `promote`, `compaction`).
- Auto-compaction com pre-flush:
  - `ChatService` consulta `runAutoCompactionWithMemoryFlushIfNeeded()` antes do turno principal;
  - se `checkCompactionNeed()` indicar `compaction_needed`, executa flush/promocao/compactacao.
- Memory flush guiado por LLM com fallback heuristico:
  - turno utilitario usando prompts de politica (`memory_write(target='daily')`);
  - fallback local gera resumo heuristico curto em `memory/YYYY-MM-DD.md` quando o LLM falha/nao escreve.
- Promocao de memoria de longo prazo (LLM-guided):
  - turno utilitario dedicado para promover fatos duraveis usando `memory_search/memory_get/memory_write(target='long_term')`.
- Dedupe textual basico em `memory_write(target='long_term')`:
  - bloqueia append quando o texto normalizado ja existe literalmente em `MEMORY.md`.

Fluxo (manual `/compact`):
1. `ChatService` identifica comando via `MemoryOrchestrator.isCompactCommand()`.
2. `MemoryOrchestrator.runManualCompact()` executa:
   - `flushSessionToDailyMemory()`;
   - `promoteLongTermMemoryIfNeeded()`;
   - `TurnOrchestrator.compactNow()`.
3. `ChatService` responde com resumo operacional (motivos, paths, contagens e status).

Fluxo (auto-compaction):
1. `ChatService` chama `runAutoCompactionWithMemoryFlushIfNeeded()` antes do turno normal.
2. `TurnOrchestrator.checkCompactionNeed()` avalia limiar.
3. Se necessario, roda flush + promocao + compaction.
4. Turno principal segue com contexto resumido.

Decisoes arquiteturais:
- Separar politica de memoria (`MemoryPolicy`) da orquestracao (`MemoryOrchestrator`):
  - prompts, comando `/compact` e fallback heuristico ficam centralizados em `src/memory/policy.ts`.
- Reusar `TurnOrchestrator` para utility turns:
  - evita duplicar pipeline de execucao/pi tools.
- Compaction continua em mensagem `system` com prefixo `[compaction]`:
  - preserva compatibilidade com guardrails existentes de contexto.
- Fallback local para flush:
  - garante persistencia minima de contexto mesmo quando LLM falha.

Observabilidade:
- Logs de inicio/fim para:
  - `chat.compact.auto.started|finished`
  - `chat.compact.memory_flush.started|finished|failed`
  - `chat.compact.long_term_promote.started|finished|failed`
  - `session.context.compacted`

Arquivos-chave:
- `src/memory/orchestrator.ts`
- `src/memory/policy.ts`
- `src/memory/service.ts`
- `src/chat/service.ts`
- `src/chat/turn-orchestrator.ts`
- `src/chat/turn-orchestrator.test.ts`
- `src/memory/service.test.ts`

Limitacoes atuais:
- Dedupe semantica atual e heuristica (tokens + jaccard/containment), sem embeddings/telemetria de calibracao.
- Promocao para longo prazo depende de utility turn (LLM); quando nao ha escrita, o resultado e `no_change`.
- Heuristica de fallback salva resumo utilitario, mas nao faz extracao semantica de fatos.

Proximo passo recomendado:
- Calibrar thresholds da deduplicacao semantica com telemetria/uso real e, depois, evoluir para dedupe semantica mais robusta (ex.: embeddings opcionais).
