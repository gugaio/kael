# Fase 9 - Research Web API-first

Status: em andamento

## Objetivo

Adicionar capacidade de pesquisa web ao Kael com baixa complexidade operacional:

- sem browser headless na fase inicial;
- com fontes citadas no retorno;
- com historico de pesquisa por sessao para continuidade.

## Decisoes arquiteturais

1. Search API-first
- Tool `web_search` no runtime PI.
- Provider plugavel via contrato `SearchProvider`.
- Implementacao inicial: `TavilySearchProvider`.

2. Dominio dedicado
- `src/research/types.ts`: contratos de query/resposta/provider.
- `src/research/provider.ts`: adapters de provider.
- `src/research/service.ts`: orquestracao (dedupe, filtros, memoria por sessao).

3. Persistencia simples e auditavel
- Arquivos em `dataDir/research/<sessionKey>.json`.
- Mantem ultimas 50 pesquisas por sessao.

## Fluxo

1. PI chama tool `web_search`.
2. Tool delega para `ResearchService`.
3. Service chama provider com timeout.
4. Service aplica filtros/dedupe e monta `answer + sources + notes`.
5. Service persiste entrada no historico da sessao.
6. Tool retorna resultado estruturado para o agente.

## Fase 9.2 (enriquecimento por URL)

- Tool `web_fetch` adicionada ao PI.
- `ResearchService.fetchUrl()` com:
  - download HTTP/HTTPS;
  - extracao de texto limpo de HTML;
  - cache por URL em `dataDir/research/fetch-cache.json`;
- TTL configuravel para reduzir latencia/custo de repeticao.

## Fase 9.3 (sintese com evidencia)

- Tool `web_research` adicionada ao PI.
- Pipeline: `web_search` -> `web_fetch` (top N fontes) -> sintese textual.
- Retorno inclui:
  - `summary`;
  - `evidence` por fonte (com/extrato fetched quando disponivel);
  - `confidence` (0..1) e `confidenceReason`.

## Fase 9.4 (item 1 - SSRF hardening)

- `web_fetch` agora valida host/IP antes do request (bloqueia localhost e faixas privadas).
- Redirects sao seguidos manualmente com revalidacao em cada salto.
- Limite de redirects configuravel por `KAEL_RESEARCH_FETCH_MAX_REDIRECTS`.

## Configuracao

- `KAEL_RESEARCH_ENABLED`
- `KAEL_RESEARCH_PROVIDER=tavily`
- `KAEL_RESEARCH_API_KEY`
- `KAEL_RESEARCH_MAX_RESULTS`
- `KAEL_RESEARCH_MAX_RESULTS_LIMIT`
- `KAEL_RESEARCH_TIMEOUT_MS`
- `KAEL_RESEARCH_FETCH_MAX_CHARS`
- `KAEL_RESEARCH_FETCH_CACHE_TTL_MS`

## Limitacoes desta fase

- Sem Playwright/browser control.
- Sem re-ranking semantico avancado.
- Extracao HTML ainda simplificada (regex), sem parser DOM dedicado.

## Proximo passo recomendado

Fase 9.4: melhorar ranking de evidencia e heuristica de confianca com sinais de recencia/autoridade.
