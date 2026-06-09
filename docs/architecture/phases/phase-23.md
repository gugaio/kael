# Arquitetura - Fase 23 (Streamer)

Status: em andamento

## Objetivo

Adicionar ao Kael uma capability `streamer` para clonar uma janela curta de
streams HLS/DASH reais e servi-la como origem HTTP local para testes de players.

O foco inicial e operacional:

- CLI minimalista: `kael streamer clone <url>`;
- parsing de master/media playlist HLS;
- parsing de MPD DASH VOD com `SegmentTemplate`, `SegmentTimeline`,
  `SegmentList` e `BaseURL`;
- selecao de variant em master playlist com default `aac-highest` para playback web;
- clone opcional da ladder completa com `--all-variants`;
- download sequencial de segmentos ate `cumulativeDuration >= duration`;
- clonagem de janela aproximada por offset (`--start 16:00 --duration 60`);
- rewrite de media playlist local ou master local apontando para variants clonadas;
- origin HTTP local com CORS para players web, Smart TVs, STBs e ferramentas de QA;
- simulacao live com sliding window virtual sobre os segmentos clonados;
- gestao local dos origins clonados via `list`, `inspect`, `probe` e `remove`;
- analise profunda de segmentos locais amostrados via `analyze`;
- relatorio HTML de analise detalhada com foco em timeline de audio;
- fault injection via origins derivados com `mutate`;
- clonagem de renditions separadas de audio e subtitles referenciadas por `EXT-X-MEDIA`.
- clonagem de Representations DASH de video e audio/texto para `index.mpd`
  local com `SegmentList`.

## Decisao arquitetural

- A capability chama-se `streamer`, nao `mock`, porque a fronteira representa
  operacao real de streams, nao apenas fixture falsa.
- O subdominio fica dentro de `video`, em `src/capabilities/video/streamer-service.ts`,
  reaproveitando `VideoInspectToolService.inspectHls()` e
  `VideoInspectToolService.inspectDash()` como primitivos de parsing/fetch de
  manifestos.
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
  browser, codecs detectados, audio externo, contagem de arquivos locais e um
  resumo de `ffprobe` amostrado.
- `streamer probe [originId|latest]` roda a mesma validacao sem rede sobre um
  origin ja clonado, incluindo manifests, segmentos, init segments locais e
  `ffprobe` amostrado sobre playlists locais reescritas.
- `streamer analyze [originId|latest]` roda `ffprobe` diretamente em chunks
  locais amostrados para extrair duracao real, PTS e sinal basico de keyframes
  sem contaminar o fluxo do `probe`, que continua leve.
- O relatorio do `analyze` tambem calcula delta entre `EXTINF` e duracao real,
  continuidade aproximada entre chunks da mesma playlist e alinhamento basico
  audio/video por duracao dos segmentos amostrados.
- O `analyze` emite `issues` estruturadas com severidade e suporta `--json`
  para automacao/CI sem depender do formato humano da CLI.
- `streamer analyze --full` percorre todos os segmentos das playlists
  consideradas e calcula continuidade de timestamps de audio entre chunks
  consecutivos, emitindo `audio_timestamp_discontinuity` para gaps/overlaps.
- `streamer analyze --html` gera um relatorio estatico em
  `analysis.html`, com resumo, issues, discontinuities de audio, media summary
  e tabela por chunk. O HTML e derivado do mesmo JSON do `analyze`.
- O report HTML tambem exibe tempos de asset em formato humano (`mm:ss` ou
  `h:mm:ss`) e uma secao `A/V Timeline Drift`, que compara as janelas de
  manifesto de video e audio externo por indice de segmento para destacar
  mudancas de cadencia como video curto contra audio normal.
- `streamer mutate` cria um novo origin derivado e registra `derivedFrom`/`faults`
  no `origin.json`; a primeira fault suportada e `discontinuity`, injetada no
  manifesto local antes de um segmento escolhido.
- `segment-swap` troca o arquivo local de um segmento alvo por um segmento donor
  vindo de outro origin, com `--with-discontinuity` opcional para comparar
  comportamento de player com e sem a tag HLS.
- `segment-swap` tambem aceita `--ffmpeg-profile hevc` para transcodar o donor
  antes da troca e injetar um chunk mais agressivo, util para reproduzir falhas
  reais de compatibilidade/decoder.
- Renditions externas usam indexacao por tipo nas rotas live (`/live/audio/0`,
  `/live/subtitles/0`) para manter semantica estavel e evitar acoplamento ao
  indice global interno do `origin.json`.
- O "corta-corrente" usa segmentos inteiros: ele para quando a soma das duracoes
  clonadas atinge ou ultrapassa a duracao alvo. Corte frame-exato fica para uma
  etapa futura com FFmpeg.
- `streamer clone --start <time>` seleciona uma janela por tempo acumulado do
  manifesto, aceitando segundos, `mm:ss` ou `hh:mm:ss`. A selecao continua por
  segmento inteiro e cada chunk clonado registra `timelineStartSeconds` e
  `timelineEndSeconds` para aparecer no `analyze`/HTML.
- `streamer clone --start-segment <n> --segment-count <n>` seleciona uma janela
  por indice zero-based de segmento original, util para continuar uma clonagem
  depois dos primeiros chunks sem precisar calcular o offset temporal. Quando a
  janela exige mais segmentos do que o default, o clone aumenta automaticamente a
  leitura do manifesto ate cobrir `startSegment + segmentCount`.
- A CLI de clone registra em stderr o indice original de cada segmento baixado
  (`original=<n>`) em download, retry e sucesso, mantendo visibilidade de qual
  chunk da origem esta em processamento.
- `streamer analyze` tambem aceita `--start-segment <n> --segment-count <n>`
  para limitar a analise a uma janela de chunks originais ja clonados; o report
  textual exibe `original=<n>` por segmento analisado.
- `streamer clone` tambem aceita DASH (`.mpd` ou `--format dash`): o clone
  inspeciona Representations, baixa init segment + media segments, gera um
  `index.mpd` local e preserva o mesmo contrato de `inspect`, `probe` e
  `analyze` usado pelos origins HLS.
- `origin.json` tem `schemaVersion` explicito. A fase atual usa apenas o schema
  mais recente; origins antigos podem ser removidos e recriados.
- `kael streamer live` sem `originId` resolve para o origin mais recente
  listado pelo storage local. `remove` permanece explicito e exige `--yes`.
- Media playlists fMP4/CMAF sem DRM e sem byte range preservam `EXT-X-MAP`:
  o init segment e baixado para `init/*` e o manifesto local/live aponta para
  esse arquivo local.
- Master playlists com `EXT-X-MEDIA TYPE=AUDIO` e `TYPE=SUBTITLES` clonam apenas
  os grupos usados pelos variants selecionados via `AUDIO="<group>"` e
  `SUBTITLES="<group>"`. I-frame playlists ainda sao ignoradas nesta fase.

## Estrutura de arquivos

```text
src/capabilities/video/
  inspect-service.ts        # parsing HLS/DASH usado pelo streamer
  streamer-diagnostics.ts   # diagnostico de codecs/browser para origins clonados
  streamer-report-html.ts   # render HTML estatico do analyze
  streamer-service.ts       # fachada publica + clone/probe/analyze
  streamer-service.test.ts  # testes unitarios/integracao leve
  types.ts                  # contratos Streamer*
  streamer/
    origin-store.ts         # persistencia e gestao de origin.json
    origin-server.ts        # servidores HTTP VOD e live virtual
    mutation.ts             # fault injection e segment swap
    hls-manifests.ts        # serializacao de manifests HLS locais
    dash-manifests.ts       # serializacao de MPDs DASH locais
    options.ts              # normalizacao compartilhada de clone/probe/analyze
    segment-downloader.ts   # download de chunks com timeout e retry
    segment-window.ts       # selecao temporal/por indice para HLS e DASH

src/cli/index.ts            # bootstrap da CLI e registro dos grupos de comandos
src/cli/streamer-commands.ts # namespace kael streamer
src/cli/streamer-output.ts  # formatacao e diagnostico textual do streamer
```

## Comandos operacionais

```bash
kael streamer clone <url.m3u8> --duration 60 --all-variants
kael streamer clone <url> --start 16:00 --duration 60
kael streamer clone <url> --start-segment 200 --segment-count 50
kael streamer clone <url.mpd> --duration 60
kael streamer clone <url> --format dash --duration 60
kael streamer list
kael streamer inspect <originId>
kael streamer inspect latest
kael streamer probe
kael streamer probe <originId>
kael streamer analyze
kael streamer analyze <originId>
kael streamer analyze <originId> --json
kael streamer analyze <originId> --full --html
kael streamer analyze <originId> --full --html --start-segment 200 --segment-count 50
kael streamer analyze <originId> --full --html --output /tmp/kael-stream-report.html
kael streamer mutate <originId> --fault discontinuity --at-segment 5
kael streamer mutate <originId> --fault segment-swap --at-segment 5 --with-origin <donorOrigin> --with-segment 1
kael streamer mutate <originId> --fault segment-swap --at-segment 5 --with-origin <donorOrigin> --with-segment 1 --ffmpeg-profile hevc
kael streamer serve <originId>
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
  | baixa renditions de audio/subtitles referenciadas por AUDIO/SUBTITLES
  | escreve segments/* ou variants/<n>/segments/*
  | escreve audio/<n>/segments/* quando houver audio externo
  | escreve subtitles/<n>/segments/* quando houver subtitles externos
  | escreve index.m3u8 local (media ou master)
  | escreve origin.json
  v
StreamerService.serveOrigin()
  |
  | HTTP local com CORS
  v
playbackUrl: http://127.0.0.1:<port>/index.m3u8
```

## Fluxo DASH

```text
CLI
  |
  | kael streamer clone <url.mpd> --duration 60 --serve
  v
StreamerService.cloneDash()
  |
  | inspectDash(root)
  |-- MPD: seleciona Representation de video highest/lowest/index ou todas com --all-variants
  |-- baixa init segment + media segments da janela escolhida
  |-- baixa Representations de audio/texto como renditions locais
  |-- escreve variants/<n>/segments/* e audio/<n>/segments/*
  |-- escreve index.mpd local com SegmentList
  |-- escreve origin.json com protocol=dash
  v
StreamerService.serveOrigin()
  |
  | HTTP local com CORS
  v
playbackUrl: http://127.0.0.1:<port>/index.mpd
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
  |-- multi variant/renditions externas: master apontando para /live/<variant>/index.m3u8, /live/audio/<n>/index.m3u8 e /live/subtitles/<n>/index.m3u8
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
  |
  | GET /live/subtitles/<n>/index.m3u8
  |-- media playlist live para a rendition de subtitles
  |
  | GET /live/subtitles/<n>/segments/<sequence>.vtt
  |-- mapeia sequence % segmentosSubtitleClonados.length para arquivo local
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
- Reescrita DASH gera MPD VOD estatico local com `SegmentList`; o parser inicial
  cobre `SegmentTemplate` com `SegmentTimeline`, duracao fixa, `SegmentList` e
  `BaseURL`.
- Sem clonagem local de chaves DRM/AES (`EXT-X-KEY`), byte ranges ou I-frame
  playlists nesta primeira entrega.
- Download ainda sequencial; retry de segmento e curto e sem backoff sofisticado.
- Diagnostico de compatibilidade e baseado em CODECS/grupo de audio e existencia
  de arquivos, com complemento de `ffprobe` amostrado e limitado por quantidade
  maxima de playlists locais por probe.
- `analyze` aprofunda o diagnostico em chunks locais amostrados, mas continua
  propositalmente limitado para manter custo e complexidade sob controle; use
  `--full` quando a investigacao for de gaps/overlaps reais de audio.
- Quando PTS de audio e video usam relogios diferentes ou reiniciam por
  segmento, o `analyze` reporta esse alinhamento como indisponivel em vez de
  tratar como erro automaticamente.
- A deteccao de `audio_timestamp_discontinuity` compara timestamps de audio
  entre segmentos consecutivos de uma mesma playlist/rendition. Ela nao tenta
  ainda corrigir PTS, remuxar chunks ou correlacionar eventos reais de player.
- A deteccao de `av_timeline_window_drift` e um sinal operacional, nao uma
  prova isolada de stream invalido: ela compara boundaries/duracoes declaradas
  e duracao real por segmento de video contra a rendition de audio de mesmo
  indice para encontrar janelas onde a cadencia entre playlists externas pode
  sensibilizar players como Tizen.
- Fault injection agora cobre alteracoes de manifesto e um primeiro caso com
  FFmpeg (`segment-swap --ffmpeg-profile hevc`), mas ainda nao cobre mudancas
  mais finas de PTS/PCR/GOP por segmento.
- DASH inicial nao cobre live MPD dinamico, DRM, byte range, `SegmentBase` nem
  multiplos Periods com timeline complexa. `streamer live` continua restrito a
  origins HLS; origins DASH sao servidos como VOD local via `streamer serve`.

## Proximos incrementos

1. Adicionar suporte a `EXT-X-KEY`/DRM ou byte ranges quando houver demanda real.
2. Expor API quando houver fluxo de automacao/planner que precise controlar
   origins persistentes.
3. Avaliar `EXT-X-I-FRAME-STREAM-INF` quando houver caso real de trickplay/seek.
4. Suportar byte range ou DRM somente quando surgir caso real que justifique o
   aumento de complexidade.
