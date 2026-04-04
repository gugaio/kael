# Exemplos de Analise - hls.js

Exemplos de como esta skill deve raciocinar.

## Exemplo 1: live sem sintomas claros

Entrada:

- stream: `live`
- objetivo: nao especificado
- config:
  - `liveSyncDurationCount: 4`
  - `maxBufferLength: 30`

Leitura esperada:

- nao assumir problema;
- explicar que os valores parecem mais voltados a estabilidade do que a latencia curta;
- se o usuario nao reclamou de atraso alto, nao empurrar tuning agressivo;
- responder algo como:
  - "se voce nao tem sintoma claro, manter isso ou ate voltar ao baseline/default faz mais sentido do que continuar afinando no escuro".

## Exemplo 2: live com foco em low latency e atraso alto

Entrada:

- stream: `live`
- objetivo: `low latency`
- sintomas:
  - atraso alto em relacao ao evento
- config:
  - `liveSyncDurationCount: 6`
  - `liveMaxLatencyDurationCount: 12`
  - `maxBufferLength: 30`

Leitura esperada:

- classificar a config como conservadora para o objetivo;
- citar tradeoff entre folga e atraso;
- sugerir revisar live edge e buffer frontal antes de mexer em parametros de segundo nivel.

## Exemplo 3: device com memoria fraca

Entrada:

- stream: `vod`
- device: TV
- sintomas:
  - pressao de memoria
- config:
  - `backBufferLength: Infinity`
  - `maxBufferSize: 60000000`

Leitura esperada:

- nao chamar `Infinity` de erro por si so;
- explicar que o default pode ser pesado nesse device;
- sugerir considerar reducao de `backBufferLength` antes de mudar muitos outros campos.

## Exemplo 4: conflito formal

Entrada:

- config:
  - `liveSyncDurationCount: 3`
  - `liveSyncDuration: 12`

Leitura esperada:

- apontar conflito formal imediatamente;
- citar que o projeto nao permite misturar configuracao por segmentos e por segundos para essa familia de parametros;
- tratar isso como prioridade maior que qualquer tuning fino.

## Exemplo 5: startup ruim com `startLevel` alto

Entrada:

- stream: `vod`
- objetivo: `fast startup`
- sintomas:
  - primeiro frame lento
- config:
  - `startLevel: 4`

Leitura esperada:

- dizer que forcar nivel inicial alto pode piorar startup;
- sugerir voltar para adaptativo ou reduzir agressividade;
- deixar claro que isso nao elimina a possibilidade de gargalo de rede/origem.
