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
  - `jobs/VideoJobService`
  - `jobs/VideoJobCapability`
  - `VideoInspectToolService`
  - `VideoManifestAuditService`
  - `PlaybackTriageService`
  - `VideoGenerationService`
  - `VideoArtifactsService`
- Dentro de `video`, a integracao com `JobManager` deve ficar isolada no subdominio `jobs/`, deixando claro que e uma borda operacional da capability de video, nao o coracao do dominio.
- Tratar players como adapters de ingest/normalizacao, nao como capabilities do core.
- Tratar providers de geracao como adapters plugaveis, nao como contratos centrais.

## Contratos canônicos iniciais

- `PlaybackEvent`
- `PlaybackSessionInput`
- `PlaybackAnalysisReport`
- `HlsManifestAuditInput`
- `HlsManifestAuditReport`
- `VideoGenerationRequest`
- `StoredArtifactRecord`

Nota:
- `PlaybackSessionInput` aceita `logText` como entrada principal para manter
  ingest flexivel desde o inicio; `events` estruturados seguem como formato
  opcional/derivado quando houver adapters dedicados por player.
- `PlaybackTriageService` faz triagem deterministica de sinais; a interpretacao
  final por LLM continua sendo uma camada separada.

## Entregas implementadas (incremento 20.0)

- Tipos canônicos iniciais para playback/generation em `src/capabilities/video/types.ts`.
- `PlaybackTriageService` com heuristicas iniciais de:
  - erro fatal;
  - rebuffer/stall;
  - startup lento.
- `VideoArtifactsService` para persistir outputs gerados e metadados no data dir.
- `ProviderBackedVideoGenerationService` com geracao de imagem baseada no provider atual e persistencia de artifacts.
- Wiring inicial no app/chat tooling para expor a camada de playback analysis e video generation ao runtime.
- Tool PI `playback_analyze` adicionada com contrato text-first (`logText`) e suporte opcional a `events`.
- Adapter inicial de `hls.js` adicionando parsing dedicado de log text e heuristicas de:
  - `MANIFEST_LOAD_ERROR`
  - `FRAG_LOAD_ERROR`
  - oscilacao de `LEVEL_SWITCHED`
- Nova capability `VideoManifestAuditService` para auditoria deterministica de manifestos HLS:
  - classifica master/media playlist;
  - detecta falhas estruturais em ladder e grupos de audio;
  - valida `TARGETDURATION` e duracao dos primeiros segmentos;
  - pode expandir a auditoria em memoria para variants de uma master playlist;
  - devolve `issues`, `variantAudits`, `aggregateIssues`, severidade e recomendacoes operacionais.
- Tool PI `video_manifest_audit` adicionada para expor a auditoria ao agente.
- CLI `manifest-audit` ganhou `--follow-variants` e `--max-variants` para executar auditoria expandida localmente sem persistencia.
- Nova capability `VideoManifestDiffService` para comparar dois audits HLS e destacar:
  - mudancas de `playlistType`;
  - deltas de stats (`variants`, `renditions`, `segments`, `targetDuration`, etc.);
  - issues e aggregate issues adicionadas/removidas entre esquerda e direita.
  - diff de variants em memoria com matching por `uri`, path comparavel e fallback por assinatura de ladder (`resolution|bandwidth|codecs`);
  - classificacao de variants em `added|removed|changed|regressed|improved|unchanged`.
- Tool PI `video_manifest_diff` adicionada para expor diff deterministico ao agente.
- CLI `manifest-diff` adicionada para comparar dois manifests localmente.

## Proximos incrementos

1. Expor tools dedicadas no PI:
   - `video_generate_image`
   - `video_dash_inspect`
2. Adicionar adapters de normalizacao por player:
   - `hlsjs`
   - `shaka`
   - `exoplayer`
   - `avplayer`
3. Evoluir auditoria de manifesto para DASH e aprofundar diff entre versoes com comparacao de variants/artifacts persistidos.
4. Evoluir geracao de video real por providers plugaveis (`veo`, `seedance`).
5. Integrar validacoes de playback/video QA ao planner (`assert_*`).
