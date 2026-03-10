---
name: youbora
description: Use quando o usuario quiser consultar dados do Youbora/NPAW (views, plays, erros, QoE, tipo vod/live, janelas de tempo e granularidade). Esta skill deve montar URL assinada (MD5) e buscar dados em api.npaw.com.
argument-hint: "[fromDate] [toDate-opcional] [metrics] [type-opcional] [granularity-opcional]"
disable-model-invocation: false
user-invocable: true
---

# Youbora (NPAW) no Kael

Objetivo: consultar a API do Youbora com autenticacao por token MD5 usando credenciais do `.env`.

## Credenciais (via ENV)

Esta skill exige:

- `KAEL_YOUBORA_ACCOUNT_CODE` (ex.: `/globo`)
- `KAEL_YOUBORA_API_KEY`
- `KAEL_YOUBORA_HOST` (default recomendado: `https://api.npaw.com`)

Nunca hardcode credenciais na resposta.
Nunca imprima API key completa; no maximo mascarada.

## Fluxo obrigatorio

1. Validar se as variaveis de ambiente existem.
2. Se faltar algo, responder claramente o que falta.
3. Executar o script local da skill:
   - `${CLAUDE_SKILL_DIR}/scripts/query-youbora.mjs`
4. Retornar:
   - URL final sem token completo (mascarar token)
   - status HTTP
   - resumo do payload
   - blocos de erro claros em caso de falha

## Chamada recomendada

Use os argumentos recebidos na invocacao (`$ARGUMENTS`) para popular:

- `fromDate` (obrigatorio)
- `toDate` (opcional)
- `metrics` (default: `views`)
- `type` (opcional: `vod|live`)
- `granularity` (opcional: `hour|day|week|month`)

### Regra de data

- Se `fromDate` for relativo (`last24hours`, `last7days`), nao enviar `toDate`.

## Execucao

Rode:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/query-youbora.mjs $ARGUMENTS
```

Se `$ARGUMENTS` vier vazio, pedir ao usuario ao menos `fromDate`.

## Exemplo de invocacao

- `/youbora last24hours`
- `/youbora "2025-03-20 00:00:00" "2025-03-20 17:50:25" views vod hour`
- `/youbora "2025-03-20 00:00:00" "" views,plays,errors vod day`

## Formato de resposta

Sempre responder com:

1. `consulta`: parametros efetivos usados
2. `resultado`: status + resumo de campos importantes do payload
3. `proximo passo`: sugestao objetiva (ex.: mudar metricas/granularidade/janela)
