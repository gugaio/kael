# Fontes Oficiais - hls.js Config Advisor

Base oficial usada por esta skill.

## Repositorio oficial

- `docs/API.md`
  - https://github.com/video-dev/hls.js/blob/master/docs/API.md
- `src/config.ts`
  - https://github.com/video-dev/hls.js/blob/master/src/config.ts

## Site oficial

- Classe `Hls`
  - https://hlsjs.video-dev.org/api-docs/hls.js.hls
- `LatencyControllerConfig`
  - https://hlsjs.video-dev.org/api-docs/hls.js.latencycontrollerconfig

## Pontos canonicos a lembrar

- `Hls.config` representa `userConfig` sobreposto ao `DefaultConfig`.
- `docs/API.md` lista defaults e explica o comportamento esperado de muitos parametros.
- `src/config.ts` e a fonte canônica para:
  - defaults efetivos do projeto;
  - restricoes de merge;
  - conflitos invalidos de configuracao.
- Ao haver diferenca de interpretacao, priorizar:
  1. `src/config.ts`
  2. `docs/API.md`
  3. `api-docs`

## Fatos oficiais já consolidados nesta skill

- `docs/API.md` documenta:
  - `maxBufferLength` default `30`
  - `backBufferLength` default `Infinity`
  - `frontBufferFlushThreshold` default `Infinity`
  - `maxBufferSize` default `60 * 1000 * 1000`
- `docs/API.md` descreve `maxBufferLength` como o buffer minimo garantido que o `hls.js` tentara alcancar, independentemente de `maxBufferSize`.
- `docs/API.md` descreve `backBufferLength` como o quanto de midia ja reproduzida pode ser mantido, lembrando que o browser ainda pode fazer eviction por conta propria.
- `src/config.ts` valida que:
  - nao se deve misturar `liveSyncDurationCount/liveMaxLatencyDurationCount` com `liveSyncDuration/liveMaxLatencyDuration`
  - `liveMaxLatencyDurationCount` precisa ser maior que `liveSyncDurationCount`
- `LatencyControllerConfig` oficial inclui:
  - `liveSyncDurationCount`
  - `liveMaxLatencyDurationCount`
  - `liveSyncDuration`
  - `liveMaxLatencyDuration`
  - `maxLiveSyncPlaybackRate`
  - `liveSyncOnStallIncrease`
