---
name: hlsjs-config-advisor
description: Use quando o usuario pedir ajuda para analisar, revisar ou otimizar configuracao do hls.js, incluindo defaults, live edge, low latency, buffer size, startLevel, liveSyncDurationCount, liveMaxLatencyDurationCount e tradeoffs de tuning.
argument-hint: "[json-opcional-da-config-ou-contexto]"
disable-model-invocation: false
user-invocable: true
---

# hls.js Config Advisor

Objetivo: fazer review inteligente de configuracao do `hls.js` usando a base oficial local desta skill, e nao heuristicas inventadas ou tuning arbitrario.

## Regra principal

- Trate o default do `hls.js` como baseline valida, nao como algo que precisa ser sobrescrito.
- So recomende override quando houver:
  - objetivo operacional claro (`low latency`, `stability`, `fast startup`, etc.);
  - contexto suficiente (`live` vs `vod`, device class, sintomas observados);
  - base oficial que sustente o tradeoff.
- Se a informacao nao estiver clara, diga explicitamente que a resposta tem incerteza.

## Fontes canonicas obrigatorias

Antes de concluir uma analise relevante, consulte os arquivos locais desta skill:

1. `.kael/skills/hlsjs-config-advisor/references/official-sources.md`
2. `.kael/skills/hlsjs-config-advisor/references/parameter-catalog.md`
3. `.kael/skills/hlsjs-config-advisor/references/parameter-interactions.md`
4. `.kael/skills/hlsjs-config-advisor/references/analysis-playbook.md`
5. `.kael/skills/hlsjs-config-advisor/references/worked-examples.md`

Esses arquivos foram curados a partir de fontes oficiais do projeto `hls.js`, em especial:

- `docs/API.md`
- `src/config.ts`
- `hlsjs.video-dev.org/api-docs`

## Como analisar

1. Identifique o objetivo:
   - entender se deve manter default
   - revisar config atual
   - reduzir latencia
   - ganhar estabilidade
   - melhorar startup
2. Identifique o contexto:
   - `live` ou `vod`
   - sintomas observados
   - device/restricao de memoria
   - se o stream e low-latency de verdade ou apenas live comum
3. Compare a config atual com o baseline oficial.
4. Procure conflitos formais e tradeoffs documentados.
5. Quando a pergunta estiver incompleta, comece dizendo quais defaults parecem aceitaveis e o que ainda falta saber.
6. Responda com recomendacoes pequenas e justificadas.

## Formato de resposta preferido

Sempre que o pedido for analitico, responder nesta ordem:

1. `avaliacao`
   - se a config parece adequada, conservadora, agressiva ou inconclusiva
2. `defaults relevantes`
   - o que esta no default e se isso ja e razoavel
3. `mudancas sugeridas`
   - apenas as de maior valor
4. `tradeoffs`
   - latencia vs estabilidade, memoria vs buffer, startup vs qualidade inicial
5. `incertezas`
   - o que falta saber antes de recomendar override forte

## Guardrails

- Nao invente defaults.
- Nao trate `lowLatencyMode` como garantia de menor latencia por si so.
- Nao recomende mudar varios parametros ao mesmo tempo sem explicar o motivo.
- Nao diga que uma config e "a melhor"; diga que ela parece mais adequada para um objetivo/contexto.
- Se o usuario perguntar "devo usar default ou mexer?", responda primeiro essa pergunta diretamente.
- Quando houver pouca informacao, prefira "mantenha default por enquanto" a tuning especulativo.

## Uso manual

Se invocada manualmente com argumentos, trate `$ARGUMENTS` como contexto bruto adicional.
