# Catalogo de Parametros - hls.js

Catalogo curto de parametros mais relevantes para discussoes iniciais de tuning.

## Defaults oficiais relevantes

Defaults documentados em `docs/API.md` e `src/config.ts`:

- `maxBufferLength: 30`
- `backBufferLength: Infinity`
- `frontBufferFlushThreshold: Infinity`
- `maxBufferSize: 60 * 1000 * 1000`
- `maxBufferHole: 0.1`
- `lowLatencyMode: true`
- `startLevel: undefined`
- `initialLiveManifestSize: 1`
- `maxMaxBufferLength: 600`
- `maxStarvationDelay: 4`
- `maxLoadingDelay: 4`
- `highBufferWatchdogPeriod: 2`
- `nudgeOffset: 0.1`
- `nudgeMaxRetry: 3`

Observacao:
- defaults podem mudar por versao; se a versao do usuario for sensivel, valide contra a versao alvo do projeto.

## Parametros de buffer

### `maxBufferLength`

- Default: `30` segundos.
- Papel: tamanho minimo de buffer que o `hls.js` tenta atingir, independentemente de `maxBufferSize`.
- Leitura pratica:
  - maior: mais folga contra jitter, mais memoria e possivelmente mais atraso em live;
  - menor: menos memoria/latencia, mais sensibilidade a throughput instavel.
- Regra de analise:
  - em `vod`, o default costuma ser baseline razoavel;
  - em `live`, so reduzir se o objetivo de latencia for claro e a origem suportar isso.

### `backBufferLength`

- Default: `Infinity`.
- Papel: quanto de midia reproduzida o player ainda tenta manter no buffer para tras.
- Leitura pratica:
  - maior: melhor para back seek imediato;
  - menor: reduz uso de memoria, importante em TVs e devices fracos.
- Regra de analise:
  - nao assumir que `Infinity` e ruim por si so;
  - considerar reducao quando houver pressao de memoria ou device fraco.

### `maxBufferSize`

- Default: `60 * 1000 * 1000` bytes.
- Papel: limite minimo de bytes a partir do qual o `hls.js` para de carregar mais fragmentos a frente.
- Leitura pratica:
  - menor: menor footprint de memoria;
  - maior: mais espaco para buffering, mas mais risco em devices limitados.

### `frontBufferFlushThreshold`

- Default: `Infinity`.
- Papel: limite maximo de buffer a frente do playhead antes de eviction ativa de ranges nao contiguos.
- Leitura pratica:
  - quando `Infinity`, o `hls.js` nao força eviction ativa por esse criterio;
  - o valor sempre sera pelo menos `maxBufferLength`.

## Parametros de live/latencia

### `lowLatencyMode`

- Default: `true`.
- Papel: habilita comportamento especifico de low-latency quando o stream/contexto suportam.
- Guardrail:
  - nao tratar `true` como prova de que a sessao esta realmente low-latency;
  - a eficacia depende do stream, da origem e do restante da config.

### `liveSyncDurationCount`

- Papel: quantidade de segmentos usada para definir a distancia alvo do live edge.
- Leitura pratica:
  - menor: mais perto do live edge, maior risco de stall;
  - maior: mais folga operacional, mais atraso.
- Regra de analise:
  - so reduzir quando o objetivo for explicitamente latencia baixa;
  - se o usuario nao souber o objetivo, priorize explicar o tradeoff antes de sugerir valor.

### `liveMaxLatencyDurationCount`

- Papel: limite de tolerancia maxima, em segmentos, para antes de estrategias de recuperacao do live edge.
- Leitura pratica:
  - precisa ser maior que `liveSyncDurationCount`;
  - janela curta demais pode produzir recuperacao agressiva;
  - janela larga demais pode aceitar atraso excessivo.

### `liveSyncDuration`

- Papel: alternativa baseada em segundos, e nao em contagem de segmentos, para definir o alvo de live sync.
- Guardrail:
  - nao deve ser misturado com `liveSyncDurationCount`.

### `liveMaxLatencyDuration`

- Papel: alternativa baseada em segundos para latencia maxima tolerada.
- Guardrail:
  - nao deve ser misturado com `liveMaxLatencyDurationCount`;
  - precisa ser maior que `liveSyncDuration`.

### `maxLiveSyncPlaybackRate`

- Papel: controla o quanto o player pode acelerar playback para recuperar atraso de live.
- Leitura pratica:
  - maior: recupera atraso mais rapido;
  - tambem pode introduzir aceleracao perceptivel ou oscilacao.

### `liveSyncOnStallIncrease`

- Papel: controla o aumento do alvo de sync depois de stall em live.
- Leitura pratica:
  - pode ser relevante quando a pergunta do usuario envolver recuperacao depois de stalls e aumento progressivo de latencia.

## Parametros de startup/ABR

### `startLevel`

- Default: `undefined`.
- Papel: define o nivel inicial de qualidade, quando explicitado.
- Leitura pratica:
  - override alto pode piorar startup e risco de stall inicial;
  - manter adaptativo costuma ser o baseline mais seguro.
- Regra de analise:
  - se o problema e `fast startup`, evitar forcar um nivel inicial alto sem evidencia.

### `initialLiveManifestSize`

- Default: `1`.
- Papel: quantidade inicial de fragments/entries usada na logica de bootstrap de live.
- Regra de analise:
  - so discutir esse parametro quando o usuario estiver realmente depurando startup/edge cases de live bootstrap; nao e ajuste de primeira linha.

### `maxStarvationDelay`

- Default documentado: `4s`.
- Papel: influencia o quanto o ABR tolera risco de rebuffer ao escolher nivel quando nenhuma opcao evita starvation.
- Regra de analise:
  - parametro de segundo nivel; prefira revisitar ladder/throughput antes de mexer aqui.

### `maxLoadingDelay`

- Default documentado: `4s`.
- Papel: participa da estrategia de escolha de nivel e recuperacao quando a carga prevista esta ruim.
- Regra de analise:
  - raramente deve ser a primeira recomendacao para usuarios sem telemetria detalhada.
