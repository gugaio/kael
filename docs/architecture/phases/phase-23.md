# Arquitetura - Fase 23 (Streamer)

Status: em andamento

## Objetivo

Adicionar ao Kael uma capability `streamer` para clonar uma janela curta de
streams HLS reais e servi-la como origem HTTP local para testes de players.

O foco inicial e operacional:

- CLI minimalista: `kael streamer clone <url>`;
- parsing de master/media playlist HLS;
- selecao de variant em master playlist;
- clone opcional da ladder completa com `--all-variants`;
- download sequencial de segmentos ate `cumulativeDuration >= duration`;
- rewrite de media playlist local ou master local apontando para variants clonadas;
- origin HTTP local com CORS para players web, Smart TVs, STBs e ferramentas de QA;
- simulacao live com sliding window virtual sobre os segmentos clonados.
- gestao local dos origins clonados via `list`, `inspect` e `remove`.

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
- O "corta-corrente" usa segmentos inteiros: ele para quando a soma das duracoes
  clonadas atinge ou ultrapassa a duracao alvo. Corte frame-exato fica para uma
  etapa futura com FFmpeg.
- `origin.json` tem `schemaVersion` explicito. Clones legados sem essa chave sao
  carregados como schema 1 em memoria para preservar compatibilidade.
- `kael streamer live` sem `originId` resolve para o origin mais recente
  listado pelo storage local. `remove` permanece explicito e exige `--yes`.

## Estrutura de arquivos

```text
src/capabilities/video/
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
  |-- master: seleciona variant highest/lowest/index ou todas com --all-variants
  |-- media: usa playlist diretamente
  |
  | baixa segmentos sequencialmente ate cumulativeDuration >= duration
  | escreve segments/* ou variants/<n>/segments/*
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
  |-- multi variant: master apontando para /live/<variant>/index.m3u8
  |
  | GET /live/<variant>/index.m3u8
  |-- calcula janela por tempo atual
  |-- incrementa EXT-X-MEDIA-SEQUENCE
  |-- omite EXT-X-ENDLIST
  |
  | GET /live/<variant>/segments/<sequence>.ts
  |-- mapeia sequence % segmentosClonados.length para arquivo local
```

## Contratos iniciais

- `StreamerCloneInput`
- `StreamerCloneResult`
- `StreamerClonedSegment`
- `StreamerClonedVariant`
- `StreamerOriginSummary`
- `StreamerRemoveResult`
- `StreamerServeOptions`
- `StreamerServeHandle`
- `StreamerLiveServeOptions`
- `StreamerLiveServeHandle`

## Limitacoes assumidas na POC

- Live atual e um loop infinito de segmentos clonados; nao tenta reproduzir
  wallclock/PTS real da origem.
- Reescrita de manifesto gera uma media playlist local simples em vez de preservar
  todos os tags do manifesto original. Em `--all-variants`, gera tambem uma
  master local simples com `EXT-X-STREAM-INF`.
- Sem clonagem local de chaves DRM/AES, `EXT-X-MAP`, subtitles ou audio
  renditions separadas nesta primeira entrega.
- Download ainda sequencial; retry de segmento e curto e sem backoff sofisticado.

## Proximos incrementos

1. Preservar tags essenciais adicionais (`EXT-X-MAP`, `EXT-X-KEY`, byte ranges)
   quando o manifesto exigir.
2. Adicionar suporte a renditions separadas de audio/subtitle no clone/live.
3. Expor API quando houver fluxo de automacao/planner que precise controlar
   origins persistentes.
4. Adicionar diagnostico pos-clone com `ffprobe` amostrado para validar segmentos.
