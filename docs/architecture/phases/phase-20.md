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

- `@gugaio/vhs` e a superficie `streamer` sao o dominio estruturado de video/stream no core.
- `ffmpeg` fica como capability operacional de baixo nivel para casos que o VHS nao cobre.
- Manter no Kael somente os subservicos que dependem de contexto de agente ou execucao local:
  - `jobs/JobService`
  - `ffmpeg/createFfmpegJobs`
  - `VideoGenerationService`
  - `MediaArtifactsService`
- Inspect, auditoria/diff de manifestos e triagem de playback vivem em
  `@gugaio/vhs`, como API determinística reutilizável por qualquer agente.
- Quando o problema for analise semantica de configuracao de player (por exemplo `hls.js`), preferir skill especializada com base oficial curada em vez de heuristica hardcoded no core.
- O lifecycle de processos fica em `jobs/JobService`; `ffmpeg` apenas valida
  entradas e constroi comandos para esse executor generico.
- Tratar players como adapters de ingest/normalizacao, nao como capabilities do core.
- Tratar providers de geracao como adapters plugaveis, nao como contratos centrais.
- O parser de logs e a triagem deterministica de playback vivem no VHS
  (`@gugaio/vhs`). Kael preserva apenas a tool PI, telemetria e contexto de
  sessao; `sessionKey` nao cruza a fronteira do harness.

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
- `PlaybackTriageService` do VHS faz triagem deterministica de sinais; a interpretacao
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
- ~~Nova capability `VideoManifestAuditService` para auditoria deterministica de manifestos HLS.~~
  ~~Tool PI `video_manifest_audit`, CLI `manifest-audit`.~~
- ~~Nova capability `VideoManifestDiffService` para comparar dois audits HLS.~~
  ~~Tool PI `video_manifest_diff`, CLI `manifest-diff`.~~
- **Removido em 2026-06-27:** `manifestAudit`, `manifestDiff` e todo o ferramental
  de auditoria/diff foram removidos para simplificar o runtime. O `videoInspect`
  (`MediaInspector`) cobre `inspectHls` e `probe` para o agente.
- Skill `.kael/skills/hlsjs-config-advisor` adicionada como base inicial de conhecimento para review de configuracao do `hls.js`:
  - usa referencias oficiais curadas do projeto `hls.js`;
  - orienta o agente a partir de defaults, tradeoffs e conflitos formais;
  - evita cristalizar opinioes de tuning no core do Kael.

## Proximos incrementos

1. Expor tools dedicadas no PI:
   - `video_generate_image`
   - `video_dash_inspect`
2. Cruzar a skill de configuracao com evidencia observada:
   - usar `PlaybackAnalysisReport`/telemetria para priorizar recomendacoes;
   - separar melhor sintoma de player config vs problema estrutural de stream/CDN.
3. Adicionar bases equivalentes para outros players:
   - `hlsjs`
   - `shaka`
   - `exoplayer`
   - `avplayer`
4. Evoluir auditoria de manifesto para DASH e aprofundar diff entre versoes com comparacao de variants/artifacts persistidos.
5. Evoluir geracao de video real por providers plugaveis (`veo`, `seedance`).
6. Integrar validacoes de playback/video QA ao planner (`assert_*`).
