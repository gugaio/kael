# Arquitetura - Fase 20 (Video Intelligence Platform)

Status: em andamento

## Objetivo

Expandir o Kael de "runtime operacional de ffmpeg" para uma plataforma de
inteligencia de video, capaz de:

- analisar assets, manifests e sessoes de playback;
- diagnosticar problemas por player (`AVPlayer`, `ExoPlayer`, `hls.js`, `Shaka`);
- gerar artifacts de imagem/video por providers plugaveis;
- persistir evidencias e outputs para auditoria e automacao.

## Decisao arquitetural

- Manter `video` como capability raiz.
- Evoluir o dominio por subservicos, nao por um monolito:
  - `VideoJobService`
  - `VideoInspectToolService`
  - `PlaybackAnalysisService`
  - `VideoGenerationService`
  - `VideoArtifactsService`
- Tratar players como adapters de ingest/normalizacao, nao como capabilities do core.
- Tratar providers de geracao como adapters plugaveis, nao como contratos centrais.

## Contratos canônicos iniciais

- `PlaybackEvent`
- `PlaybackSessionInput`
- `PlaybackAnalysisReport`
- `VideoGenerationRequest`
- `StoredArtifactRecord`

Nota:
- `PlaybackSessionInput` aceita `logText` como entrada principal para manter
  ingest flexivel desde o inicio; `events` estruturados seguem como formato
  opcional/derivado quando houver adapters dedicados por player.

## Entregas implementadas (incremento 20.0)

- Tipos canônicos iniciais para playback/generation em `src/capabilities/video/types.ts`.
- `PlaybackAnalysisService` com heuristicas iniciais de:
  - erro fatal;
  - rebuffer/stall;
  - startup lento.
- `VideoArtifactsService` para persistir outputs gerados e metadados no data dir.
- `ProviderBackedVideoGenerationService` com geracao de imagem baseada no provider atual e persistencia de artifacts.
- Wiring inicial no app/chat tooling para expor a camada de playback analysis e video generation ao runtime.
- Tool PI `playback_analyze` adicionada com contrato text-first (`logText`) e suporte opcional a `events`.

## Proximos incrementos

1. Expor tools dedicadas no PI:
   - `video_generate_image`
   - `video_dash_inspect`
   - `video_manifest_diff`
2. Adicionar adapters de normalizacao por player:
   - `hlsjs`
   - `shaka`
   - `exoplayer`
   - `avplayer`
3. Evoluir geracao de video real por providers plugaveis (`veo`, `seedance`).
4. Integrar validacoes de playback/video QA ao planner (`assert_*`).
