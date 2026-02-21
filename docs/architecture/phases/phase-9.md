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

## Configuracao

- `KAEL_RESEARCH_ENABLED`
- `KAEL_RESEARCH_PROVIDER=tavily`
- `KAEL_RESEARCH_API_KEY`
- `KAEL_RESEARCH_MAX_RESULTS`
- `KAEL_RESEARCH_MAX_RESULTS_LIMIT`
- `KAEL_RESEARCH_TIMEOUT_MS`

## Limitacoes desta fase

- Sem Playwright/browser control.
- Sem re-ranking semantico avancado.
- Sem fetch aprofundado por URL (usa somente resultado da Search API).

## Proximo passo recomendado

Fase 9.2: enrich de fontes com fetch por URL e sumarizacao com citacoes mais fortes.

