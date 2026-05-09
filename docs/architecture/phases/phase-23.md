# Arquitetura - Fase 23 (Streamer)

Status: em andamento

## Objetivo

Adicionar ao Kael uma capability `streamer` para clonar uma janela curta de
streams HLS reais e servi-la como origem HTTP local para testes de players.

O foco inicial e operacional:

- CLI minimalista: `kael streamer clone <url>`;
- parsing de master/media playlist HLS;
- selecao de variant em master playlist com default `aac-highest` para playback web;
- clone opcional da ladder completa com `--all-variants`;
- download sequencial de segmentos ate `cumulativeDuration >= duration`;
- rewrite de media playlist local ou master local apontando para variants clonadas;
- origin HTTP local com CORS para players web, Smart TVs, STBs e ferramentas de QA;
- simulacao live com sliding window virtual sobre os segmentos clonados;
- gestao local dos origins clonados via `list`, `inspect`, `probe` e `remove`;
- clonagem de renditions separadas de audio referenciadas por `EXT-X-MEDIA`.

## Decisao arquitetural

- A capability chama-se `streamer`, nao `mock`, porque a fronteira representa
  operacao real de streams, nao apenas fixture falsa.
- O subdominio fica dentro de `video`, em `src/capabilities/video/streamer-service.ts`,
  reaproveitando `VideoInspectToolService.inspectHls()` como primitivo de
  parsing/fetch de manifestos.
- O storage local fica em `<KAEL_DATA_DIR>/streamer/origins/<originId>/`.
- A primeira entrega e CLI-only. Nenhum endpoint HTTP novo foi criado nesta fase.
- O servidor de origin e local e efemero, iniciado por `--serve`; ele serve os
  arquivos clonados com CORS permissivo.
- `--all-variants` clona todas as variants da master playlist e gera uma
  master local em `index.m3u8`; `--max-variants` permite limitar o peso quando
  a ladder for grande.
- `kael streamer live <originId>` serve um clone existente como live. O live e
  calculado on-demand pela hora atual, sem worker de background: `MEDIA-SEQUENCE`
  avanca virtualmente e cada segmento virtual mapeia por modulo para um chunk
  ja clonado.
- A CLI de clone emite progresso incremental no terminal durante inspecao e
  download de segmentos. Downloads de segmento usam timeout proprio, maior que o
  timeout de manifesto, com retry curto para reduzir falhas transientes em chunks
  grandes.
- O seletor default de master playlist e `aac-highest`: ele prefere variants com
  audio AAC/mp4a e evita EC-3/AC-3 para reduzir falhas em browser. `highest`,
  `lowest`, `aac-lowest` e indice zero-based continuam disponiveis quando o teste
  precisa de uma escolha explicita.
- `streamer clone` imprime diagnostico pos-clone com compatibilidade basica de
  browser, codecs detectados, audio externo e contagem de arquivos locais.
- `streamer probe [originId|latest]` roda a mesma validacao sem rede sobre um
  origin ja clonado, incluindo manifests, segmentos e init segments locais.
- O "corta-corrente" usa segmentos inteiros: ele para quando a soma das duracoes
  clonadas atinge ou ultrapassa a duracao alvo. Corte frame-exato fica para uma
  etapa futura com FFmpeg.
- `origin.json` tem `schemaVersion` explicito. A fase atual usa apenas o schema
  mais recente; origins antigos podem ser removidos e recriados.
- `kael streamer live` sem `originId` resolve para o origin mais recente
  listado pelo storage local. `remove` permanece explicito e exige `--yes`.
- Media playlists fMP4/CMAF sem DRM e sem byte range preservam `EXT-X-MAP`:
  o init segment e baixado para `init/*` e o manifesto local/live aponta para
  esse arquivo local.
- Master playlists com `EXT-X-MEDIA TYPE=AUDIO` clonam apenas os grupos de audio
  usados pelos variants selecionados. Subtitles e I-frame playlists ainda sao
  ignoradas nesta fase.

## Estrutura de arquivos

```text
src/capabilities/video/
  inspect-service.ts        # parsing HLS usado pelo streamer
  streamer-diagnostics.ts   # diagnostico de codecs/browser para origins clonados
  streamer-service.ts       # clone HLS + origin HTTP local
  streamer-service.test.ts  # testes unitarios/integracao leve
  types.ts                  # contratos Streamer*

src/cli/index.ts            # namespace kael streamer
```

## Comandos operacionais

```bash
kael streamer clone <url> --duration 60 --all-variants
kael streamer list
kael streamer inspect <originId>
kael streamer inspect latest
kael streamer probe
kael streamer probe <originId>
kael streamer live
kael streamer live <originId> --window-size 5
kael streamer remove <originId> --yes
```

## Fluxo inicial

```text
CLI
  |
  | kael streamer clone <url> --duration 60 --serve
  v
StreamerService.cloneHls()
  |
  | inspectHls(root)
  |-- master: seleciona variant aac-highest/highest/lowest/index ou todas com --all-variants
  |-- media: usa playlist diretamente
  |
  | baixa segmentos sequencialmente ate cumulativeDuration >= duration
  | baixa renditions de audio referenciadas por AUDIO="<group>"
  | escreve segments/* ou variants/<n>/segments/*
  | escreve audio/<n>/segments/* quando houver audio externo
  | escreve index.m3u8 local (media ou master)
  | escreve origin.json
  v
StreamerService.serveOrigin()
  |
  | HTTP local com CORS
  v
playbackUrl: http://127.0.0.1:<port>/index.m3u8
```

## Fluxo live

```text
CLI
  |
  | kael streamer live <originId> --window-size 5
  v
StreamerService.serveLiveOrigin()
  |
  | GET /index.m3u8
  |-- single variant: media playlist live
  |-- multi variant/audio externo: master apontando para /live/<variant>/index.m3u8 e /live/audio/<n>/index.m3u8
  |
  | GET /live/<variant>/index.m3u8
  |-- calcula janela por tempo atual
  |-- incrementa EXT-X-MEDIA-SEQUENCE
  |-- omite EXT-X-ENDLIST
  |
  | GET /live/<variant>/segments/<sequence>.ts
  |-- mapeia sequence % segmentosClonados.length para arquivo local
  |
  | GET /live/audio/<n>/index.m3u8
  |-- media playlist live para a rendition de audio
  |
  | GET /live/audio/<n>/segments/<sequence>.<ext>
  |-- mapeia sequence % segmentosAudioClonados.length para arquivo local
```

## Contratos iniciais

- `StreamerCloneInput`
- `StreamerCloneResult`
- `StreamerClonedSegment`
- `StreamerClonedVariant`
- `StreamerClonedRendition`
- `StreamerCloneDiagnostic`
- `StreamerOriginSummary`
- `StreamerRemoveResult`
- `StreamerServeOptions`
- `StreamerServeHandle`
- `StreamerLiveServeOptions`
- `StreamerLiveServeHandle`

## Limitacoes assumidas na POC

- Live atual e um loop infinito de segmentos clonados; nao tenta reproduzir
  wallclock/PTS real da origem.
- Reescrita de manifesto preserva apenas o basico necessario para playback local,
  `EXT-X-MAP` simples e audio groups externos. Em `--all-variants`, gera tambem
  uma master local simples com `EXT-X-STREAM-INF`/`EXT-X-MEDIA`.
- Sem clonagem local de chaves DRM/AES (`EXT-X-KEY`), byte ranges, subtitles ou
  I-frame playlists nesta primeira entrega.
- Download ainda sequencial; retry de segmento e curto e sem backoff sofisticado.
- Diagnostico de compatibilidade e baseado em CODECS/grupo de audio e existencia
  de arquivos; validacao profunda com `ffprobe` fica para incremento futuro.

## Proximos incrementos

1. Adicionar suporte a `EXT-X-KEY`/DRM ou byte ranges quando houver demanda real.
2. Adicionar suporte a subtitles no clone/live.
3. Expor API quando houver fluxo de automacao/planner que precise controlar
   origins persistentes.
4. Adicionar validacao amostrada com `ffprobe` para checar integridade real dos
   segmentos clonados.
