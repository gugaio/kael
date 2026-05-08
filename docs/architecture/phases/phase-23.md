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
- origin HTTP local com CORS para players web, Smart TVs, STBs e ferramentas de QA.

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
- O "corta-corrente" usa segmentos inteiros: ele para quando a soma das duracoes
  clonadas atinge ou ultrapassa a duracao alvo. Corte frame-exato fica para uma
  etapa futura com FFmpeg.

## Estrutura de arquivos

```text
src/capabilities/video/
  streamer-service.ts       # clone HLS + origin HTTP local
  streamer-service.test.ts  # testes unitarios/integracao leve
  types.ts                  # contratos Streamer*

src/cli/index.ts            # namespace kael streamer
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

## Contratos iniciais

- `StreamerCloneInput`
- `StreamerCloneResult`
- `StreamerClonedSegment`
- `StreamerClonedVariant`
- `StreamerServeOptions`
- `StreamerServeHandle`

## Limitacoes assumidas na POC

- HLS VOD/media playlist simples; live loop fica para incremento posterior.
- Reescrita de manifesto gera uma media playlist local simples em vez de preservar
  todos os tags do manifesto original. Em `--all-variants`, gera tambem uma
  master local simples com `EXT-X-STREAM-INF`.
- Sem clonagem local de chaves DRM/AES, `EXT-X-MAP`, subtitles ou audio
  renditions separadas nesta primeira entrega.
- Download sequencial, sem retry/backoff dedicado.

## Proximos incrementos

1. Preservar tags essenciais adicionais (`EXT-X-MAP`, `EXT-X-KEY`, byte ranges)
   quando o manifesto exigir.
2. Adicionar modo live/sliding window com incremento de `MEDIA-SEQUENCE`.
3. Expor API quando houver fluxo de automacao/planner que precise controlar
   origins persistentes.
4. Adicionar diagnostico pos-clone com `ffprobe` amostrado para validar segmentos.
