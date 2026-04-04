# Interacoes e Conflitos - hls.js

## Conflitos formais em `src/config.ts`

O `hls.js` rejeita configuracoes invalidas no merge.

### Nao misturar modo por contagem com modo por duracao

Nao misturar:

- `liveSyncDurationCount`
- `liveMaxLatencyDurationCount`

com:

- `liveSyncDuration`
- `liveMaxLatencyDuration`

Se ambos os grupos forem usados juntos, `src/config.ts` lanca erro.

## Restricao formal de ordenacao

`liveMaxLatencyDurationCount` deve ser maior que `liveSyncDurationCount`.

De forma analoga:

`liveMaxLatencyDuration` deve ser maior que `liveSyncDuration`.

## Interacoes praticas

### `maxBufferLength` x latencia de live

- buffer frontal maior pode ser coerente com estabilidade;
- em `live`, isso pode conflitar com objetivo de atraso curto.

### `backBufferLength` x memoria

- manter muito buffer para tras pode ser aceitavel em desktop;
- em TV/device limitado, pode virar custo sem ganho real.

### `startLevel` x startup

- forcar um nivel inicial alto pode piorar primeiro frame e startup robusto;
- manter adaptativo e geralmente o baseline mais seguro quando o usuario nao tem evidencia contraria.

### `lowLatencyMode` x realidade do stream

- habilitar `lowLatencyMode` nao compensa sozinho uma origem com atraso alto, segmentos longos ou CDN inconsistente.
- nao atribuir todo problema de latencia a um unico parametro de player.

### `maxBufferLength` x `maxBufferSize`

- `docs/API.md` deixa claro que `maxBufferLength` e o buffer minimo garantido que o player tenta atingir, mesmo se isso exceder o equivalente em bytes de `maxBufferSize`.
- `maxBufferSize` funciona como um limite minimo de bytes para parar de carregar mais a frente, nao como substituto direto da politica temporal de buffer.
- Na pratica:
  - nao trate esses dois campos como se fossem o mesmo controle em unidades diferentes.

### `frontBufferFlushThreshold` x `maxBufferLength`

- `frontBufferFlushThreshold` nunca fica abaixo de `maxBufferLength`.
- Se o usuario tentar usar um valor muito baixo para flush mantendo `maxBufferLength` alto, a expectativa operacional pode ficar incoerente.

### Contagem de segmentos x segundos

- Para live sync e max latency, o projeto suporta duas familias de parametro:
  - por contagem de segmentos
  - por duracao em segundos
- A analise deve apontar explicitamente qual familia a config usa hoje.
