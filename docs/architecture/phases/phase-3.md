# Arquitetura - Fase 3 (Resiliencia Operacional)

Status: em andamento

## Objetivo

Adicionar resiliencia sem perder simplicidade: o sistema deve falhar de forma previsivel, recuperar e evitar duplicacao de trabalho.

## Escopo previsto

- Retry utilitario com backoff exponencial + jitter.
- Dedupe/idempotency para rotas criticas (`/chat`, `/jobs/*`).
- Classificacao de erro no engine remoto para fallback inteligente.
- Guard de contexto e reset de sessao em falhas fatais.

## Entregas implementadas (incremento atual)

- Retry generico em `src/infra/retry.ts` com politica configuravel.
- `PiEngineAdapter` com retry e classificacao de erro (`timeout`, `rate_limit`, `auth`, `provider_unavailable`, etc.).
- Fallback no modo `hybrid` orientado por tipo de erro (nao mais catch generico).
- Idempotency layer em memoria com TTL para:
  - `POST /chat`
  - `POST /jobs/transcode`
  - `POST /jobs/hls`
  - `POST /jobs/capture`
  - `POST /jobs/probe`
- Protecao de conflito de chave idempotente com payload divergente (`409`).
- `TurnOrchestrator` para centralizar preparacao de turno antes da engine.
- Context guard inicial por janela:
  - limite de mensagens (`KAEL_CONTEXT_MAX_MESSAGES`)
  - limite de caracteres (`KAEL_CONTEXT_MAX_CHARS`)
- `PiEngineAdapter` (SDK embutido) agora recebe contexto recente no prompt.

## Pendencias desta fase

- Reset automatico de sessao em falhas irrecoveraveis.
- Evoluir idempotency store para persistente (se necessario).
- Adicionar resumos de contexto (alem de truncamento por janela) para preservar fatos relevantes.

## Design proposto

### 1) Retry layer

- Local: `src/infra/retry.ts`
- Uso: wrappers de chamadas externas (PI adapter, possiveis integrações futuras)

### 2) Idempotency layer

- Chave: header `x-idempotency-key` ou campo equivalente.
- Store inicial: memoria com TTL (evoluir para persistente se necessario).
- Comportamento: retornar resposta cacheada para request duplicada.

### 3) Failover/classificacao

- Mapear erros em classes (timeout, rate_limit, auth, provider_unavailable).
- Em `hybrid`, decidir fallback com base no motivo, nao so catch generico.

### 4) Session safety

- Heuristica de tamanho de contexto para prevenir overflow.
- Reset controlado da sessao em corrupcao irrecuperavel.

## Criterios de pronto da fase

- Rotas criticas idempotentes.
- Falhas transientes com retry padronizado.
- Logs suficientes para diagnosticar fallback/retry.
- Nenhuma regressao no fluxo de comandos de video.
