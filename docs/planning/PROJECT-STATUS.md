# PROJECT STATUS - Kael

Ultima atualizacao: **2026-07-04**
Owner: projeto Kael

## Como usar este arquivo

1. Atualize em todo commit funcional.
2. Marque fase, entregas, pendencias e proximo passo.
3. Mantenha este arquivo curto e objetivo.

## Template rapido para novo commit

Copie o bloco abaixo ao registrar um novo commit em "Registro de Atualizacoes por Commit":

```md
### YYYY-MM-DD - <titulo curto do commit>

Resumo:
- <entrega 1>
- <entrega 2>

Arquivos-chave:
- `<arquivo 1>`
- `<arquivo 2>`

Checklist de validacao:
- [ ] `npm run check`
- [ ] teste manual do fluxo principal da fase

Pendencias:
- <pendencia 1>

Proximo passo recomendado:
- <proximo passo>
```

## Registro de Atualizacoes por Commit

### 2026-07-04 - Stream details: análise por chunk e elementary streams

Resumo:
- O VHS agora emite entradas separadas de análise para elementary streams em variants muxadas, com `streamSelector` (`v:0`/`a:0`) e `sourceKind=variant_muxed`.
- A análise de variant muxada tenta áudio como stream opcional e descarta a entrada quando o container não expõe `a:0`, evitando falso erro em video-only.
- A extração de codec/sample rate/channels passou a usar o stream selecionado pelo `streamSelector`, não o primeiro stream do container.
- A página `Stream Details` ganhou ação `Analyze selected chunk`, usando `startSegment` + `segmentCount=1`.
- O painel lateral de chunk agora renderiza múltiplas entradas ffprobe para o mesmo segmento, incluindo vídeo e áudio quando presentes.
- Corrigido fallback de erro do analyze: falhas pontuais de `ffprobe`/arquivo local agora retornam entrada `ok=false` em `entries`, em vez de derrubar a rota com HTTP 500.
- A UI agora mostra `details.cause` em erros da API quando ainda houver falha 500 externa ao probe.
- Corrigida a chamada do `MediaInspector.probe` no VHS para preservar o receiver (`this`); a falha real era `Cannot read properties of undefined (reading 'maxProbeTimeoutMs')` ao chamar `analyzeOrigin`.
- Validado diretamente contra o origin local `osoutros` em `/home/gugaime/.kael/data/streamer`: `startSegment=0` retornou video H.264, duas renditions AAC e legenda WebVTT sem falhas.

Arquivos-chave:
- `../vhs/src/stream/analysis.ts`
- `../vhs/src/stream/analysis-model.ts`
- `../vhs/src/stream/analysis-probe.ts`
- `../vhs/src/stream/analysis-rules.ts`
- `../vhs/test/stream.test.ts`
- `../vhs/SKILL.md`
- `ui/src/lib/api.ts`
- `ui/src/pages/StreamDetailsPage.tsx`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm --prefix ../vhs run build`
- [x] `npm --prefix ../vhs run check`
- [x] `npm --prefix ../vhs test -- test/stream.test.ts`
- [x] `npm --prefix ui run check`
- [x] `npm --prefix ui run build`
- [x] `npm run check`
- [x] `npx vitest run src/api/server.test.ts`

Pendencias:
- Nenhuma conhecida.

Proximo passo recomendado:
- Usar o fluxo diário em stream real para confirmar se a UI mostra `v:0` e `a:0` nos chunks `.ts` muxados e ajustar thresholds de A/V se aparecerem falsos positivos.

### 2026-06-27 - Stream playground: painel de logs hls.js

Resumo:
- O toggle `hls.js debug` agora exibe um painel de logs no playground.
- O player captura eventos hls.js via `customListeners` do `@clappr/hlsjs-playback`, incluindo attach, manifest, level, fragment e error events.
- O `hlsjsConfig.debug` agora recebe um logger customizado para renderizar tambem os logs internos `debug/log/info/warn/error` do hls.js.
- O painel mantem logs em ordem newest-first e registra a recriacao do player ao ativar debug.
- Adicionado painel visual de diagnostico com cards de manifest/chunks/buffer/timeline/A-V sync, timeline de fragmentos e findings para erros de manifesto, chunks, buffer, discontinuity e PTS/DTS.
- O card de timeline separa atividade normal de PTS/DTS/timestamp de issues reais para evitar falso positivo visual.
- Os cards de chunks exibem start/duration, range PTS e gap/overlap em relacao ao `endPTS` do chunk anterior, sem poluir a tabela de logs brutos.
- A timeline de chunks extrai `frag.elementaryStreams` quando disponivel, exibindo PTS do fragmento e PTS de elementary stream para video/audio, alem do delta A/V do audio contra o video do mesmo `sn`.
- O painel de logs ganhou botao `Copy` para copiar as linhas capturadas em formato tabulado.
- A timeline limita os cards por track separadamente para evitar que audio/unknown esconda os ultimos chunks de video.
- Adicionado historico visual de erros de request HLS, com totais por manifesto/chunk/level e codigo HTTP quando exposto pelo hls.js.
- Adicionada pagina `Stream Details` para origins clonados, com overview, variants/renditions, lista clicavel de chunks e painel lateral de dados do manifesto/chunk.
- Expostos endpoints `POST /streams/:originId/probe` e `POST /streams/:originId/analyze` para rodar diagnostico do VHS/ffprobe sobre origins clonados; a UI dispara analise sob demanda e cruza PTS/duracao/keyframes/continuidade com o chunk selecionado.
- O serving de cloned streams ganhou modo LAN: `POST /streams/:originId/serve` aceita `host: "0.0.0.0"` e a UI mostra botao `Serve LAN` com URL acessivel pelo IP local da maquina.

Arquivos-chave:
- `src/api/routes/streams.ts`
- `docs/api.md`
- `ui/src/App.tsx`
- `ui/src/lib/api.ts`
- `ui/src/pages/StreamsPage.tsx`
- `ui/src/pages/StreamDetailsPage.tsx`
- `ui/src/pages/StreamPlaygroundPage.tsx`
- `ui/src/types/clappr.d.ts`

Checklist de validacao:
- [x] `cd ui && npm run build`
- [x] `npm run check`
- [x] `npx vitest run src/api/server.test.ts`

Pendencias:
- A analise atual do VHS ainda trata variants como stream de video principal; para chunks `.ts` muxados, o proximo incremento deve expor probe por elementary stream (`v:0` e `a:0`) no inspector.

Proximo passo recomendado:
- Testar com stream real e evoluir o inspector para probe sob demanda de um chunk especifico, incluindo audio/video dentro de `.ts` muxado.

### 2026-06-27 - Bootstrap: npm install volta a buildar VHS local

Resumo:
- Corrigido `npm install` na raiz: `vhs:build` agora compila `../vhs`, onde existe `tsconfig.json`.
- A dependencia `@gugaio/vhs` voltou para `file:../vhs`, alinhada com a fase 23 enquanto o pacote nao esta publicado com artefatos.

Arquivos-chave:
- `package.json`
- `package-lock.json`

Checklist de validacao:
- [x] `npm install`
- [x] `npm run check`
- [x] `node -e "import('@gugaio/vhs').then(...)"`

Pendencias:
- Publicar `@gugaio/vhs` com `dist` versionado/empacotado antes de voltar para dependencia GitHub/registry.

Proximo passo recomendado:
- Ajustar o pipeline de release do VHS para garantir que pacote remoto inclua `dist` ou rode build antes do pack.

### 2026-06-27 - Streams UI: playground Clappr/hls.js

Resumo:
- Adicionado botao `Play` na lista de cloned streams; ele inicia o serving quando necessario e abre o playground.
- Criada pagina `/streams/:originId/playground` com Clappr + `@clappr/hlsjs-playback`, campo de URL, reload e toggle de debug do hls.js.
- Adicionadas dependencias UI `@clappr/player`, `@clappr/hlsjs-playback` e `hls.js@1.6.2`.

Arquivos-chave:
- `ui/src/pages/StreamsPage.tsx`
- `ui/src/pages/StreamPlaygroundPage.tsx`
- `ui/src/lib/api.ts`
- `ui/package.json`

Checklist de validacao:
- [x] `npm run check`
- [x] `cd ui && npm run build`

Pendencias:
- O bundle da UI ficou maior com Clappr/hls.js; considerar lazy loading da pagina se isso virar problema.
- `npm install` reportou vulnerabilidades no grafo de dependencias da UI; revisar com `npm audit` antes de release publico.

Proximo passo recomendado:
- Testar manualmente com um clone real: clicar Play, confirmar serving automatico e reproduzir no playground.

### 2026-06-27 - Streams UI: remocao de clones persistidos

Resumo:
- Adicionado `DELETE /streams/:originId` para parar serving ativo e remover origins clonados da base local.
- A pagina `Cloned Streams` ganhou acao de delete com confirmacao e refresh da lista.

Arquivos-chave:
- `src/api/routes/streams.ts`
- `ui/src/lib/api.ts`
- `ui/src/pages/StreamsPage.tsx`
- `docs/api.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `cd ui && npm run build`
- [x] `npx vitest run src/api/server.test.ts`

Pendencias:
- Nenhuma conhecida.

Proximo passo recomendado:
- Testar manualmente com um clone real servido e confirmar que o delete remove o origin e limpa a lista.

### 2026-06-23 - Deploy Docker foundation: API autenticada e runtime de video

Resumo:
- Adicionado `KAEL_API_AUTH_TOKEN`: quando configurado, todas as rotas HTTP exigem Bearer token com comparacao em tempo constante.
- Criados `Dockerfile`, `compose.yml`, `.env.example` e guia de deploy para VPS.
- Imagem usa Node 22, `ffmpeg`, `ffprobe`, usuario de runtime sem privilegios e volumes separados para dados e workspace.
- Dependencia VHS agora e instalada do GitHub com SHA fixo, removendo o acoplamento de runtime a `../vhs`.

Arquivos-chave:
- `Dockerfile`
- `compose.yml`
- `src/api/server.ts`
- `docs/deployment-docker.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm run build`
- [x] `npm test` (284 passed, 4 skipped)
- [x] `docker compose config` (com token de teste)
- [ ] `docker compose build` (download da imagem base foi interrompido pelo ambiente de validacao)
- [ ] `docker compose up -d` + healthcheck autenticado

Pendencias:
- Adicionar Caddy, TLS e entrega da UI.
- Integrar `stream_serve` ao servidor HTTP principal para URLs publicas.

Proximo passo recomendado:
- Executar o smoke test do compose e, em seguida, adicionar o proxy HTTPS/UI.

### 2026-06-23 - Streams API + UI: clone, serve e stop de origins

Resumo:
- Criado `src/video/serve-manager.ts` com `StreamServeManager` que trackeia handles ativos de `serveOrigin`/`serveLiveOrigin`
- `serveManager` adicionado ao contrato `KaelApp` e instanciado em `createKaelApp`
- Criada rota `GET /streams` (lista origins com status de serving), `GET /streams/:originId`, `POST /streams/clone`, `POST /streams/:originId/serve`, `POST /streams/:originId/stop`
- Criada `ui/src/pages/StreamsPage.tsx` com input de clone, lista de streams clonados, botoes Serve/Stop por origin
- Adicionada entrada `Streams` na navegacao do AppShell e rota `/streams` no React Router

Arquivos-chave:
- `src/video/serve-manager.ts` (novo)
- `src/api/routes/streams.ts` (novo)
- `ui/src/pages/StreamsPage.tsx` (novo)
- `src/app.ts`
- `src/api/server.ts`
- `ui/src/App.tsx`
- `ui/src/components/AppShell.tsx`
- `ui/src/lib/api.ts`
- `docs/api.md`

Checklist de validacao:
- [x] `npx tsc --noEmit` (0 erros)
- [x] `npx vitest run` (283 passed, 4 skipped)
- [x] `cd ui && npm run build` (build OK)

Pendencias:
- `POST /streams/clone` e síncrono e pode travar por minutos em streams longas; idealmente viraria job async

Proximo passo recomendado:
- Testar fluxo completo com stream real: clonar via UI, servir, abrir URL no VLC/player, parar

### 2026-06-23 - Planner refatorado: action registry desacopla dominio de video

Resumo:
- Criado `src/planner/action-registry.ts` com `ActionRegistry` e `ActionHandler` type
- Video-specific actions (probe, capture, transcode, hls) removidas do if/else chain do `executeNext`
- Criado `src/video/planner-handlers.ts` que registra handlers de video no planner
- `PlannerExecuteRuntime` simplificado: nao tem mais callbacks de video (`startProbeMedia`, `startCaptureStream`, `startTranscode`, `startConvertHls`)
- `createPlannerExecuteRuntime` nao depende mais de `VideoJobs`
- Handler usa `requiredInputs` proprio validado em tempo de execucao
- Controles built-in (`exec`, `wait_execution`, `cancel_execution`) permanecem no planner
- `deriveStepFromTitle` mantem heuristica de titulo->kind (conveniencia, nao acoplamento)

Arquivos-chave:
- `src/planner/action-registry.ts` (novo)
- `src/video/planner-handlers.ts` (novo)
- `src/planner/service.ts`
- `src/planner/runtime.ts`
- `src/app.ts`
- `src/chat/tooling-factory.ts`
- `src/planner/service.test.ts`

Checklist de validacao:
- [x] `npx tsc --noEmit` (0 erros)
- [x] `npx vitest run` (283 passed, 4 skipped)

Pendencias:
- Nenhuma, contratos externos preservados.

Proximo passo recomendado:
- Se novos dominios surgirem (audio, image processing), criar handlers especificos e registrar no planner sem modificar `service.ts`.

### 2026-06-21 - Kael sem capability de vídeo interna

Resumo:
- `src/capabilities/video` foi removido: builders de comandos ficam em
  `src/video`, artifacts e geração em `src/media`, e a adaptação de sessão do
  VHS em `src/vhs`.
- `MediaArtifactsService` usa agora `<KAEL_DATA_DIR>/media/artifacts`.

Arquivos-chave:
- `src/video/jobs.ts`
- `src/media/artifacts.ts`
- `src/media/generation.ts`
- `src/vhs/watch-registry.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Publicar VHS em registry versionado e remover `file:../vhs`.

Proximo passo recomendado:
- Fazer smoke test de VHS contra streams reais e publicar a primeira versão.

### 2026-06-23 - Jobs: split ProcessJobService em ProcessSupervisor + JobService

Resumo:
- `ProcessJobService` foi separado em duas camadas seguindo o padrão do OpenClaw:
  - `src/process/supervisor.ts` → `ProcessSupervisor`: spawn, timeout, logs, kill-tree
  - `src/jobs/service.ts` → `JobService`: fila, persistência, delega ao supervisor
- O nome `ProcessJobService` foi removido por ser ambíguo (fazia os dois papeis)
- `ProcessSupervisor` é genérico e reusável para qualquer execução de processo
- `JobService` mantém o contrato público idêntico ao antigo `ProcessJobService`
- Testes e API preservados sem alteração de comportamento

Arquivos-chave:
- `src/process/supervisor.ts` (novo)
- `src/jobs/service.ts` (refatorado de process-service.ts)
- `src/bootstrap/runtime.ts`
- `src/jobs/service.test.ts`

Checklist de validacao:
- [x] 279 testes passando (mesmo número de antes)
- [x] `npm run check` (typecheck + lint)

Pendencias:
- Nenhuma, contratos externos preservados.

Proximo passo recomendado:
- N/A

### 2026-06-21 - Jobs: executor genérico sem registry de capability

Resumo:
- O lifecycle de processo foi movido para `ProcessJobService`: fila,
  concorrência, timeout, cancelamento, logs e status agora são genéricos.
- O registry `JobManager`/`JobCapability` e o dispatcher por action foram
  removidos; havia apenas a capability de vídeo registrada.
- Vídeo ficou com `createVideoJobs()`, funções pequenas que validam entradas e
  montam comandos de ffmpeg/ffprobe/VLC para o executor genérico.
- Endpoints, tools e planner preservam os contratos externos atuais.

Arquivos-chave:
- `src/jobs/process-service.ts`
- `src/capabilities/video/jobs/video-jobs.ts`
- `src/bootstrap/runtime.ts`
- `src/api/routes/jobs-schedules.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Publicar VHS em registry versionado e remover `file:../vhs`.

Proximo passo recomendado:
- Manter novos processos em `ProcessJobService`, sem reintroduzir registry de capabilities.

### 2026-06-20 - Fases 20/23: Kael passa a consumir VHS

Resumo:
- `streamer` do bootstrap agora usa o pacote independente `@gugaio/vhs`,
  com contratos de `KaelApp` preservados.
- A dependencia e temporariamente local (`file:../vhs`) enquanto o pacote nao
  recebe publicacao versionada.
- O runtime ativo tambem usa o inspector e o monitor HLS do VHS; Kael preserva
  somente o adaptador de `sessionKey` para tools e API existentes.
- A triagem deterministica de playback e o parser de logs hls.js tambem sao
  executados pelo VHS; Kael mantém apenas a orquestracao da tool PI.

Arquivos-chave:
- `package.json`
- `src/bootstrap/runtime.ts`
- `src/app.ts`
- `src/chat/tooling-factory.ts`
- `src/capabilities/video/stream-monitor-service.ts`
- `docs/architecture/phases/phase-23.md`
- `docs/architecture/phases/phase-20.md`

Checklist de validacao:
- [x] `npm run check`
- [x] testes de manifest e streamer
- [x] bootstrap de video com `KAEL_ENGINE_MODE=simple`

Pendencias:
- Publicar VHS em registry versionado e trocar `file:../vhs` por uma versao
  imutavel.

Proximo passo recomendado:
- Executar smoke tests do CLI VHS contra streams reais antes da primeira
  publicacao versionada.

### 2026-06-09 - Fase 23: decomposicao inicial do StreamerService

Resumo:
- `StreamerService` preserva a API publica, mas delega persistencia de origins,
  servidor VOD/live e mutation para modulos focados.
- Builders de manifests HLS e DASH foram separados por protocolo.
- Normalizacao de opcoes de clone/probe/analyze foi centralizada e compartilhada
  pelos fluxos HLS e DASH.
- Download de segmentos com timeout/retry e selecao de janelas HLS/DASH foram
  isolados em modulos proprios.
- `probeOrigin` foi extraido integralmente e a preparacao de chunks para
  `analyzeOrigin` (amostragem, init segment e leitura de metadata FFprobe) agora
  fica em modulo dedicado.
- `analyzeOrigin` foi extraido integralmente: orchestration, regras de
  continuidade/boundary, drift A/V, summaries e geracao de issues agora ficam
  fora da fachada publica.
- O clone DASH foi extraido integralmente para um modulo de caso de uso,
  incluindo selecao de Representations, download, manifests e persistencia.
- O clone HLS foi extraido integralmente para um modulo de caso de uso, com
  fluxos nomeados para ladder completa e variant selecionada.
- Helpers de nome de segmento e duracao minima entre variants agora sao
  compartilhados pelos clones HLS e DASH.
- Helpers genericos de numeros, erros e filesystem agora ficam em `src/infra`
  para reutilizacao por outras capabilities.
- O arquivo principal caiu de 3.547 para 113 linhas sem mudar contratos,
  schema de `origin.json`, rotas locais ou comportamento da CLI.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/streamer/origin-store.ts`
- `src/capabilities/video/streamer/origin-server.ts`
- `src/capabilities/video/streamer/mutation.ts`
- `src/capabilities/video/streamer/hls-manifests.ts`
- `src/capabilities/video/streamer/dash-manifests.ts`
- `src/capabilities/video/streamer/options.ts`
- `src/capabilities/video/streamer/segment-downloader.ts`
- `src/capabilities/video/streamer/segment-window.ts`
- `src/capabilities/video/streamer/probe.ts`
- `src/capabilities/video/streamer/analysis-probe.ts`
- `src/capabilities/video/streamer/analysis-rules.ts`
- `src/capabilities/video/streamer/analysis.ts`
- `src/capabilities/video/streamer/clone-hls.ts`
- `src/capabilities/video/streamer/clone-dash.ts`
- `src/capabilities/video/streamer/clone-utils.ts`
- `src/infra/numbers.ts`
- `src/infra/errors.ts`
- `src/infra/fs.ts`

Checklist de validacao:
- [x] `npm test -- src/capabilities/video/streamer-service.test.ts`
- [x] `npm run check`

Pendencias:
- Separar o arquivo de testes do streamer pelos mesmos casos de uso.
- Extrair o download de media playlist de `clone-hls.ts` apenas se o caso de uso
  precisar crescer novamente.

Proximo passo recomendado:
- Separar os testes de clone HLS/DASH dos testes de probe, analyze e serve.

### 2026-05-28 - Fase 23: Streamer por janela de segmentos

Resumo:
- `streamer clone` agora aceita `--start-segment <n>` e `--segment-count <n>` para continuar uma clonagem a partir de um indice original sem calcular offset temporal.
- O clone autoajusta `maxSegments` para cobrir janelas como `200 + 50`, e os logs de progresso mostram `original=<n>` por chunk em download/retry/sucesso.
- `streamer analyze` aceita os mesmos filtros por segmento original e mostra `original=<n>` no report textual.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/cli/streamer-commands.ts`
- `src/cli/streamer-output.ts`
- `src/capabilities/video/inspect-service.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm test -- src/capabilities/video/streamer-service.test.ts`
- [x] `npm run check`

Pendencias:
- Validar em stream real se os indices das variants/renditions externas permanecem alinhados quando a origem tem manifests inconsistentes.

Proximo passo recomendado:
- Rodar `./bin/kael streamer clone <url> --start-segment 200 --segment-count 50` no asset real e comparar os logs `original=200..249` com os chunks esperados.

### 2026-05-26 - Fase 23: Streamer DASH baseline

Resumo:
- `streamer clone` agora suporta DASH por `.mpd` ou `--format dash`, com clone de Representations de video e audio/texto.
- `inspectDash` parseia MPD VOD com `SegmentTemplate`, `SegmentTimeline`, `SegmentList` e `BaseURL`.
- Origins DASH geram `index.mpd` local e preservam `inspect`, `serve`, `probe` e `analyze` sobre os chunks clonados.

Arquivos-chave:
- `src/capabilities/video/inspect-service.ts`
- `src/capabilities/video/streamer-service.ts`
- `src/cli/streamer-commands.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `src/capabilities/video/inspect-service.test.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts`
- [x] `npm run check`

Pendencias:
- DASH live/dynamic MPD, DRM, byte range, `SegmentBase` e multiplos Periods complexos ainda fora do baseline.
- `streamer live` segue exclusivo para origins HLS.

Proximo passo recomendado:
- Testar `./bin/kael streamer clone <url.mpd> --duration 60 --serve` com MPDs reais e calibrar compatibilidade Shaka/ExoPlayer/Tizen antes de ampliar o parser.

### 2026-05-23 - CLI enxuta por grupos de comandos

Resumo:
- `src/cli/index.ts` virou apenas bootstrap da CLI e registro dos grupos de comandos.
- Comandos foram separados em modulos por dominio: core, API, manifest e streamer.
- Helpers compartilhados de CLI foram isolados em `src/cli/cli-utils.ts`.

Arquivos-chave:
- `src/cli/index.ts`
- `src/cli/streamer-commands.ts`
- `src/cli/api-commands.ts`
- `src/cli/core-commands.ts`
- `src/cli/cli-utils.ts`
- `src/cli/streamer-output.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `./bin/kael --help`
- [x] `./bin/kael streamer --help`
- [x] `./bin/kael streamer clone --help`

Pendencias:
- Avaliar se comandos de API antigos devem ganhar testes leves de help/registro.

Proximo passo recomendado:
- Manter novos comandos em arquivos de dominio para evitar que `index.ts` volte a acumular implementacao.

### 2026-05-23 - Fase 23: PTS humano no report HTML

Resumo:
- O `analysis.html` agora mostra `First PTS`, `Last PTS`, `Expected` e `Actual Next` em formato legivel.
- O valor bruto em microsegundos continua visivel no mesmo campo e no tooltip para comparacao direta com logs de player.

Arquivos-chave:
- `src/capabilities/video/streamer-report-html.ts`
- `src/capabilities/video/streamer-service.test.ts`

Checklist de validacao:
- [x] `npm test -- src/capabilities/video/streamer-service.test.ts`
- [x] `npm run check`

Pendencias:
- Avaliar se a CLI textual tambem deve formatar PTS humano ou manter apenas valores brutos.

Proximo passo recomendado:
- Re-renderizar reports existentes a partir do JSON embutido quando a analise nao precisar ser recalculada.

### 2026-05-23 - Fase 23: A/V timeline drift no analyze

Resumo:
- `streamer analyze` agora calcula janelas de drift entre video e audio externo usando timeline do manifesto e duracao real por segmento.
- O report emite issue `av_timeline_window_drift` quando audio/video divergem acima do threshold.
- O HTML ganhou a secao `A/V Timeline Drift`, com tempo humano, duracao de video/audio e deltas de inicio/fim/duracao.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/streamer-report-html.ts`
- `src/capabilities/video/types.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm test -- src/capabilities/video/streamer-service.test.ts`
- [x] `npm run check`

Pendencias:
- Calibrar o threshold de `250ms` com mais midias reais e correlacionar com travamentos em Tizen.

Proximo passo recomendado:
- Regerar o `analysis.html` do origin problemático e verificar se o segmento `166/167` aparece no topo de `A/V Timeline Drift`.

### 2026-05-23 - Fase 23: Report HTML com tempo humano

Resumo:
- O `analysis.html` agora mostra o tempo do asset em formato humano (`mm:ss`/`h:mm:ss`) no detalhe de chunks.
- Os segundos precisos continuam visiveis no mesmo campo e no tooltip para preservar analise tecnica.

Arquivos-chave:
- `src/capabilities/video/streamer-report-html.ts`
- `src/capabilities/video/streamer-service.test.ts`

Checklist de validacao:
- [x] `npm test -- src/capabilities/video/streamer-service.test.ts`
- [x] `npm run check`

Pendencias:
- Avaliar se Top Problems tambem deve ganhar uma coluna de tempo humano por issue.

Proximo passo recomendado:
- Regerar um `analysis.html` real e validar se pontos como `1002.001s` ficam mais rapidos de localizar como `16:42`.

### 2026-05-23 - Fase 23: Clone por janela temporal

Resumo:
- `streamer clone` agora aceita `--start <time>` em segundos, `mm:ss` ou `hh:mm:ss`.
- O clone seleciona uma janela aproximada por tempo acumulado do manifesto, preservando corte por segmentos inteiros.
- Segmentos clonados registram `timelineStartSeconds`/`timelineEndSeconds`, exibidos no `analyze` e no HTML.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/capabilities/video/streamer-report-html.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/streamer-service.test.ts`

Pendencias:
- Para VODs longos, ainda pode ser necessario aumentar `--max-segments` para o parser enxergar a janela desejada.
- O corte continua aproximado por segmento inteiro, sem corte frame-exato.

Proximo passo recomendado:
- Testar `./bin/kael streamer clone <url> --start 16:00 --duration 60 --max-segments 1000` em midia real e abrir `streamer analyze latest --full --html`.

### 2026-05-23 - Fase 23: Analyze full com audio timestamp discontinuity e HTML

Resumo:
- `streamer analyze --full` agora analisa todos os segmentos das playlists consideradas.
- O analyze detecta `audio_timestamp_discontinuity` em gaps/overlaps de timestamp de audio entre chunks consecutivos.
- `streamer analyze --html` gera um relatorio estatico com resumo, issues, discontinuities de audio, media summary e detalhe por chunk.

Arquivos-chave:
- `src/capabilities/video/inspect-service.ts`
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/streamer-report-html.ts`
- `src/capabilities/video/types.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/streamer-service.test.ts`

Pendencias:
- Calibrar thresholds com midias reais de producao e comparar com logs reais de player.
- Ainda nao ha fault especifica para simular `audio-gap`/`audio-delay`.

Proximo passo recomendado:
- Rodar `./bin/kael streamer analyze latest --full --html` em uma midia que gera `Unexpected audio track timestamp discontinuity` e comparar o delta reportado com o log do player.

### 2026-05-10 - Fase 23: Streamer fault injection agressiva com FFmpeg

Resumo:
- `streamer mutate --fault segment-swap` agora suporta `--ffmpeg-profile hevc` para transcodar o segmento donor antes da troca.
- A troca agressiva permite injetar um chunk HEVC dentro de uma playlist H.264 existente, aumentando a chance de falha visivel no player.
- A metadata da fault registra o donor e a descricao do origin derivado explicita quando houve transcode com FFmpeg.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`
- [x] `./bin/kael streamer mutate --help`

Pendencias:
- Ainda falta um teste manual com player real para calibrar se HEVC-in-TS ja e agressivo o bastante em todos os targets.
- O fluxo atual nao suporta donor segment com `EXT-X-MAP`.

Proximo passo recomendado:
- Rodar `segment-swap` com `--ffmpeg-profile hevc` e comparar playback/analyze com e sem `--with-discontinuity`.

### 2026-05-10 - Fase 23: Streamer fault injection segment-swap

Resumo:
- `streamer mutate` agora suporta `segment-swap`, trocando um segmento alvo por um segmento donor vindo de outro origin.
- A fault registra donor origin/playlist/segment e pode opcionalmente inserir `#EXT-X-DISCONTINUITY` com `--with-discontinuity`.
- O manifesto local preserva sua estrutura original, ajustando apenas o `EXTINF` do segmento trocado.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`
- [x] `./bin/kael streamer mutate --help`

Pendencias:
- O `segment-swap` ainda nao suporta donor segment com `EXT-X-MAP`.
- Ainda falta calibrar em manifests reais como players reagem com e sem `#EXT-X-DISCONTINUITY`.

Proximo passo recomendado:
- Rodar `segment-swap` com Bunny como donor e validar playback/analyze em um origin real antes de partir para `missing-segment` ou faults com FFmpeg.

### 2026-05-10 - Fase 23: Streamer fault injection discontinuity

Resumo:
- Adicionado `streamer mutate` para criar origins derivados com fault injetada sem alterar o clone original.
- Primeira fault suportada: `discontinuity`, que injeta `#EXT-X-DISCONTINUITY` antes de um segmento escolhido em uma variant/rendition local.
- `streamer list` e `streamer inspect` agora expõem `derivedFrom` e resumo das faults do origin.
- Adicionado `streamer serve [originId]` para servir um origin VOD existente, incluindo origins derivados por `mutate`.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- Faults com FFmpeg ainda nao foram implementadas.
- A primeira fault altera o manifesto VOD local; suporte especifico para manifest live derivado pode ser avaliado apos teste real.

Proximo passo recomendado:
- Testar `./bin/kael streamer mutate latest --fault discontinuity --at-segment 1`, servir o origin gerado com `streamer serve <id>` e depois implementar `missing-segment` ou `duration-drift`.

### 2026-05-10 - Fase 23: Streamer analyze issues e JSON

Resumo:
- `streamer analyze` agora emite `issues` estruturadas com severidade (`info`/`warning`/`error`), codigo, resumo e evidencias.
- Cobertos sinais como `duration_delta_high`, `segment_boundary_gap`, `segment_boundary_overlap`, `segment_not_keyframe_aligned`, `gop_unstable` e `av_duration_drift`.
- Adicionada flag `--json` para imprimir o relatorio completo do analyze em formato consumivel por automacao/CI.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- Thresholds iniciais ainda precisam ser calibrados com mais origins reais.

Proximo passo recomendado:
- Rodar `./bin/kael streamer analyze latest --json` em origins reais e decidir se warnings devem afetar exit code em modo CI.

### 2026-05-10 - Fase 23: Streamer analyze com resumo de saude

Resumo:
- `streamer analyze` passou a destacar delta entre `EXTINF` e duracao real (`durationDelta`) por segmento.
- O relatorio agora resume continuidade entre chunks por playlist (`boundaryStatus`/`boundaryDelta`) e sinal de GOP para video.
- Adicionado resumo simples de alinhamento audio/video por segmentos amostrados, baseado em diferenca de duracao real e PTS quando os relogios sao comparaveis.
- A saida da CLI ficou organizada em resumo geral, `media:` e `segments:` para leitura operacional mais rapida.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- O alinhamento A/V ainda e amostral e conservador; quando os PTS de audio resetam por segmento, o relatorio evita marcar isso como erro.

Proximo passo recomendado:
- Validar o `streamer analyze latest` em origin real e ajustar os thresholds de `durationDelta`/`boundaryDelta` com base em amostras reais.

### 2026-05-10 - Fase 23: Streamer analyze profundo

Resumo:
- Adicionado `kael streamer analyze [originId|latest]` como camada separada do `probe`, focada em analise profunda de segmentos locais amostrados.
- A analise usa `ffprobe` nos chunks clonados para levantar duracao real, PTS inicial/final e, para video, keyframes e maior gap entre keyframes.
- O `probe` permanece leve e operacional; a inspecao mais pesada ficou isolada para nao misturar responsabilidades de clone/serve com diagnostico profundo.

Arquivos-chave:
- `src/capabilities/video/inspect-service.ts`
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- A analise continua amostral por playlist e por segmentos; ainda nao percorre 100% da ladder.
- Subtitles podem nao entregar sinal tecnico tao rico quanto video/audio dependendo do container e do suporte do `ffprobe`.

Proximo passo recomendado:
- Se o comando se mostrar util no uso diario, ampliar o relatorio com gaps/overlaps entre segmentos e diferenca entre `EXTINF` e duracao real.

### 2026-05-10 - Fase 23: Streamer ffprobe amostrado

Resumo:
- `streamer clone` e `streamer probe` agora rodam `ffprobe` amostrado sobre playlists locais reescritas do origin para detectar clones quebrados mais cedo.
- A validacao usa um teto de playlists amostradas para manter o custo baixo e compatível com a proposta simples da capability.
- O resumo pos-clone e o relatório de `probe` passaram a expor contagem de amostras validadas, sucessos e falhas do `ffprobe`.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/cli/index.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- A validacao continua amostrada; nao percorre toda a ladder quando houver muitas playlists locais.
- Ainda nao ha teste manual com manifesto real nesta iteracao, por escolha do fluxo atual.

Proximo passo recomendado:
- Se o signal do `ffprobe` ficar estavel, o proximo ganho real e decidir entre ampliar isso com detalhes de stream/codec ou voltar para novos casos HLS como I-frame e byte range.

### 2026-05-09 - Fase 23: Streamer simplificacao de renditions

Resumo:
- Refatorada a fronteira de renditions externas para usar uma tabela unica de tipos (`AUDIO`/`SUBTITLES`) em vez de regras espalhadas.
- Rotas live de renditions passaram a usar indice por tipo (`/live/audio/0`, `/live/subtitles/0`) em vez do indice global interno.
- `streamer inspect` agora imprime o `type` da rendition, reduzindo ambiguidade operacional.
- `inspectHls` passou a preservar booleanos opcionais de `EXT-X-MEDIA` como `undefined` quando a tag nao declara o atributo.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/inspect-service.ts`
- `src/cli/index.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- O live handler ainda tem repeticao pequena entre variant e rendition ao servir arquivos/manifestos.
- Ainda nao houve revalidacao manual em manifesto real apos o refactor, por escolha desta iteracao.

Proximo passo recomendado:
- Se quiser continuar simplificando, extrair um helper unico de resolucao/serve de media no live handler antes de entrar em DRM ou byte range.

### 2026-05-09 - Fase 23: Streamer subtitles externos

Resumo:
- `streamer clone` agora clona `EXT-X-MEDIA TYPE=SUBTITLES` referenciado por `SUBTITLES="<group>"`.
- Master local e live preservam `SUBTITLES="<group>"` nas variants e publicam playlists de subtitles em `subtitles/...` e `/live/subtitles/<index>/...`.
- `streamer probe` passou a reportar audio/subtitles externos separadamente no diagnostico.
- Testes cobrem clone VOD/live com audio AAC externo e subtitle WebVTT externo no mesmo master.

Arquivos-chave:
- `src/capabilities/video/inspect-service.ts`
- `src/capabilities/video/inspect-service.test.ts`
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `src/capabilities/video/streamer-diagnostics.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- `EXT-X-I-FRAME-STREAM-INF`, `EXT-X-KEY`/DRM e byte ranges continuam fora desta fase.
- Ainda nao ha validacao profunda com `ffprobe` dos segmentos clonados.

Proximo passo recomendado:
- Rodar clone real Globo com `--serve`, validar audio/caption no player e depois decidir entre API de origins ou `ffprobe` amostrado.

### 2026-05-09 - Fase 23: Streamer diagnostico e default AAC

Resumo:
- `streamer clone` passou a usar `--variant aac-highest` como default para preferir audio AAC/mp4a e evitar EC-3/AC-3 em browser.
- Adicionado diagnostico pos-clone com compatibilidade basica de browser, codecs detectados, audio externo e contagem de arquivos locais.
- Adicionado `streamer probe [originId|latest]` para validar origins clonados sem rede.
- Teste de audio renditions passou a cobrir master com variant EC-3 de maior bitrate e confirmar selecao AAC por default.

Arquivos-chave:
- `src/capabilities/video/streamer-diagnostics.ts`
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/streamer-service.test.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`
- [x] `./bin/kael streamer clone --help`
- [x] `./bin/kael streamer probe latest`

Pendencias:
- Diagnostico ainda e baseado em metadados HLS e existencia de arquivos; nao roda `ffprobe` amostrado.
- Subtitles e I-frame playlists continuam fora do clone/live.

Proximo passo recomendado:
- Implementar `TYPE=SUBTITLES` no clone/live para cobrir captions do manifesto Globo.

### 2026-05-09 - Fase 23: Streamer audio renditions externas

Resumo:
- `inspectHls` passou a capturar atributos relevantes de audio em `EXT-X-MEDIA` (`CHANNELS`, `CHARACTERISTICS`) e `CLOSED-CAPTIONS` em variants.
- `streamer clone` agora clona renditions `TYPE=AUDIO` referenciadas pelos variants selecionados via `AUDIO="<group>"`.
- Master local preserva `EXT-X-MEDIA TYPE=AUDIO` e `AUDIO="<group>"`; subtitles/I-frame playlists continuam fora do escopo.
- Live origin serve playlists e segmentos de audio em `/live/audio/<index>/...`.
- Contrato de origin simplificado para o schema atual (`schemaVersion=2`); origins antigos devem ser removidos/recriados.

Arquivos-chave:
- `src/capabilities/video/inspect-service.ts`
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/capabilities/video/inspect-service.test.ts`
- `src/capabilities/video/streamer-service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- `TYPE=SUBTITLES` e `EXT-X-I-FRAME-STREAM-INF` ainda sao ignorados.
- `EXT-X-KEY`/DRM e byte ranges permanecem fora desta fase.

Proximo passo recomendado:
- Testar com uma master real no formato Globo VOD com `AUDIO="audio-aacl-128"` e validar playback com audio em VOD/live.

### 2026-05-09 - Fase 23: Streamer preserva EXT-X-MAP

Resumo:
- `inspectHls` passou a capturar `EXT-X-MAP` e associar o init segment aos segmentos da media playlist.
- `streamer clone` baixa o init segment para `init/*`, reescreve `EXT-X-MAP` para caminho local e contabiliza esses bytes no origin.
- `streamer live` tambem emite `EXT-X-MAP` e serve o init segment em `/live/<variant>/init/*`.

Arquivos-chave:
- `src/capabilities/video/inspect-service.ts`
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/capabilities/video/inspect-service.test.ts`
- `src/capabilities/video/streamer-service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/inspect-service.test.ts src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- `EXT-X-MAP` com `BYTERANGE` ainda nao e suportado.
- `EXT-X-KEY`/DRM permanece fora desta fase.

Proximo passo recomendado:
- Testar com um HLS CMAF/fMP4 real sem DRM e validar VOD/live no player.

### 2026-05-09 - CLI: launcher curto para desenvolvimento

Resumo:
- Adicionado wrapper `./bin/kael` para rodar a CLI TypeScript via `tsx` sem digitar `npx tsx src/cli/index.ts`.
- `package.json` agora registra o bin local em `bin/kael` e o script `npm run kael -- ...`.
- README e comandos rapidos passaram a usar `./bin/kael`.

Arquivos-chave:
- `bin/kael`
- `package.json`
- `README.md`
- `docs/core/START-HERE.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `./bin/kael streamer --help`
- [x] `npm run kael -- streamer --help`

Pendencias:
- Para usar apenas `kael` no terminal, ainda e necessario rodar `npm link` uma vez na raiz do repo.

Proximo passo recomendado:
- Usar `./bin/kael streamer ...` no fluxo diario e, se ficar estavel, promover o build/bin de distribuicao depois.

### 2026-05-09 - Fase 23: Streamer gestao de origins

Resumo:
- Adicionados comandos `kael streamer list`, `kael streamer inspect <originId>` e `kael streamer remove <originId> --yes`.
- `kael streamer live` sem `originId` agora usa o origin mais recente; `inspect latest` tambem resolve o mais recente.
- `origin.json` passou a registrar `schemaVersion`; a fase atual assume o schema mais recente.
- `StreamerService` ganhou metodos operacionais para listar, inspecionar e remover origins locais.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/capabilities/video/types.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`
- [x] `npx tsx src/cli/index.ts streamer --help`
- [x] `npx tsx src/cli/index.ts streamer live --help`

Pendencias:
- Gestao de origins ainda e CLI-only; nenhuma API HTTP nova foi criada.
- `remove` e irreversivel e por isso exige `--yes`.

Proximo passo recomendado:
- Testar o fluxo completo com origin real: `clone`, `list`, `inspect`, `live` e `remove`.

### 2026-05-08 - Fase 23: Streamer live origin

Resumo:
- Adicionado `kael streamer live <originId>` para servir um clone existente como live HLS com sliding window virtual.
- Adicionado `kael streamer clone <url> --live` como atalho para clonar e subir um live origin no mesmo processo.
- O live server gera playlists on-demand, incrementa `EXT-X-MEDIA-SEQUENCE`, omite `EXT-X-ENDLIST` e mapeia segmentos virtuais por modulo para chunks clonados.
- CLI de clone agora emite progresso incremental durante inspect/download para evitar aparencia de travamento em assets grandes.
- Live origin ganhou compatibilidade com clones legados que ainda nao possuem `variants` no `origin.json`.
- Download de segmentos agora usa timeout proprio maior (`--segment-timeout-ms`, default 60000) e retries (`--segment-retries`, default 2) para reduzir aborts em chunks grandes.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`
- [x] `npx tsx src/cli/index.ts streamer live --help`
- [x] `npx tsx src/cli/index.ts streamer clone --help`

Pendencias:
- Live atual e loop de segmentos clonados; ainda nao trata renditions separadas de audio/legenda.
- Ainda nao ha API para controlar origins live persistentes.

Proximo passo recomendado:
- Testar `kael streamer clone <url> --duration 60 --all-variants --live` em player real e validar ABR/liveness.

### 2026-05-08 - Fase 23: Streamer clone HLS local

Resumo:
- Criada a capability `streamer` dentro de video para clonar uma janela HLS localmente.
- Adicionado comando `kael streamer clone <url>` com selecao de variant, corta-corrente por `cumulativeDuration >= duration`, rewrite de manifesto local e `--serve` com origin HTTP + CORS.
- Adicionado `--all-variants`/`--all-variantes` para clonar a ladder HLS completa e gerar master local apontando para `variants/<n>/index.m3u8`.
- Documentada a nova fase de arquitetura `phase-23`.

Arquivos-chave:
- `src/capabilities/video/streamer-service.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-23.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/streamer-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- POC ainda nao preserva tags avancados como `EXT-X-MAP`, `EXT-X-KEY`, byte ranges e renditions separadas.
- Ainda nao ha modo live/sliding window.

Proximo passo recomendado:
- Testar `kael streamer clone <url> --duration 60 --all-variants --serve` com um manifesto HLS real e depois evoluir preservacao de tags essenciais.

### 2026-05-05 - Core: modulo `engine` renomeado para `agents`

Resumo:
- Fronteira de runtime foi renomeada de `src/engine` para `src/agents`
- Imports do core foram ajustados sem alterar o contrato `AgentEngine`
- Documentacao ativa de arquitetura foi atualizada para refletir o novo caminho

Arquivos-chave:
- `src/agents/factory.ts`
- `src/app.ts`
- `src/chat/turn-orchestrator.ts`
- `docs/architecture/phases/phase-2.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/agents/simple-engine.test.ts src/agents/pi-engine-adapter.test.ts src/chat/turn-orchestrator.test.ts`

Pendencias:
- Restam referencias conceituais a "engine" em docs onde o contrato `AgentEngine` continua sendo o nome oficial

Proximo passo recomendado:
- Se quiser reduzir ambiguidade futura, avaliar renomear tambem labels textuais de "engine" para "runtime de agents" onde nao houver referencia ao contrato `AgentEngine`

### 2026-05-05 - Docs: curadoria do historico para `src/agents`

Resumo:
- O historico de `PROJECT-STATUS.md` foi atualizado para apontar para `src/agents/*` em vez de caminhos removidos
- O status do rename passou a refletir as validacoes realmente executadas

Arquivos-chave:
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `rg -n "src/engine" .`

Pendencias:
- Nenhuma referencia residual a `src/engine` permanece no repositorio

Proximo passo recomendado:
- Manter novos registros de status usando apenas `src/agents/*`

### 2026-05-03 - UI-1: shell claro de dashboard com sidebar

Resumo:
- UI web migrou do tema escuro com header horizontal para um shell claro com menu lateral persistente
- Tokens visuais, badges de status e cards principais foram recalibrados para leitura em layout branco/dashboard
- Pags Ops, Chat, Plans, Jobs, Schedules, Exec e detalhes ficaram consistentes com a nova direcao visual

Arquivos-chave:
- `ui/src/components/AppShell.tsx`
- `ui/src/styles.css`
- `ui/tailwind.config.ts`
- `ui/src/components/Panel.tsx`
- `docs/ui/UI-GUIDE.md`

Checklist de validacao:
- [ ] `npm run ui:check`
- [ ] teste manual da navegacao principal em desktop/mobile

Pendencias:
- Ainda falta revisar microcopy e espacos finos de algumas tabelas/listas para o novo shell
- Ainda nao existem cards operacionais inline no chat

Proximo passo recomendado:
- Validar o comportamento responsivo do sidebar e depois evoluir o Ops com filtros/resumos mais executivos

### 2026-04-27 - Fase 22.0: Stream Watch & Quality Monitor

Resumo:
- Implementado monitoramento continuo de streams HLS com deteccao automatica de problemas de qualidade
- Parser de manifest estendido para capturar `#EXT-X-DISCONTINUITY` e `#EXT-X-DISCONTINUITY-SEQUENCE`
- `stream-snapshot-analyzer.ts`: 5 detectores (discontinuity_inserted, media_sequence_gap, stale_manifest, segment_duration_anomaly, audio_rendition_gap)
- `HlsStreamMonitorService`: servico stateful com polling recursivo via `setTimeout`, gerenciamento de sessoes por ID
- 4 endpoints REST: `POST/GET/DELETE /streams/watch`, `GET /streams/watch/:id`
- PI tool `video_stream_watch` para o agente iniciar/parar/consultar watches via linguagem natural
- Arquitetura documentada em `docs/architecture/phases/phase-22.md`

Arquivos-chave:
- `src/capabilities/video/stream-snapshot-analyzer.ts`
- `src/capabilities/video/stream-monitor-service.ts`
- `src/capabilities/video/stream-snapshot-analyzer.test.ts`
- `src/api/routes/stream-watch.ts`
- `src/agents/tool-specs/video.ts`
- `docs/architecture/phases/phase-22.md`

Checklist de validacao:
- [x] `npm run check` (0 erros)
- [ ] teste manual com URL de manifest HLS real

Pendencias:
- Testes automatizados requerem Node >=18 (crypto.getRandomValues) — issue preexistente no ambiente
- Fase 22.1: deteccao de regressao ABR (bitrate ladder)
- Fase 22.2: lipsync / keyframe alignment
- Fase 22.3: integracao com planner (alertas proativos)

Proximo passo recomendado:
- Testar manualmente `POST /streams/watch` com uma URL HLS real e verificar eventos detectados

### 2026-04-25 - Automation: scheduler isolado em submodulo

Resumo:
- O scheduler persistente e o parser cron foram movidos para `src/automation/scheduler/`.
- `src/automation/` permanece como dominio de automacoes/runners, deixando o scheduler como infraestrutura interna de agendamento.
- Documentos e diagramas ativos foram atualizados para refletir a nova fronteira.

Arquivos-chave:
- `src/automation/scheduler/persistent-scheduler.ts`
- `src/automation/scheduler/cron.ts`
- `src/automation/service.ts`
- `docs/architecture/phases/phase-4.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/automation/scheduler/cron.test.ts src/automation/scheduler/persistent-scheduler.test.ts`

Pendencias:
- O modulo `automation` ainda nao possui workflows/triggers genericos; por enquanto a automacao concreta continua baseada em schedules e runners.

Proximo passo recomendado:
- Quando houver demanda real, introduzir automacoes como composicao de trigger, condition, action e audit sem expandir prematuramente o runtime.

### 2026-04-04 - Skill: `project-writer` evoluida para curadoria incremental

Resumo:
- A skill passou a carregar um `editing-playbook` dedicado para orientar curadoria de documentos existentes, nao apenas escrita.
- O workflow agora enfatiza ler o documento atual, decidir entre `append` e `replace`, consolidar secoes sobrepostas e evitar headings duplicados.
- Foram adicionados exemplos de consolidacao de secao existente e guidance mais forte sobre estrutura de secoes e evidencia.

Arquivos-chave:
- `.kael/skills/project-writer/SKILL.md`
- `.kael/skills/project-writer/references/editing-playbook.md`
- `.kael/skills/project-writer/references/examples.md`
- `.kael/skills/project-writer/references/schema.md`
- `docs/skills.md`

Checklist de validacao:
- [x] `npm test -- src/skills/service.test.ts`

Pendencias:
- A skill ainda depende do modelo montar manualmente o `content` final para updates com `mode=replace`; nao existe patch semantico de secao por tool.

Proximo passo recomendado:
- Se essa curadoria mostrar valor real, considerar uma tool futura de edicao por secao para reduzir rewrites completos em arquivos longos.

### 2026-04-04 - Project Space: sugestao/confirmacao leve de novos `.md` no prompt

Resumo:
- O `ChatService` passou a injetar uma politica explicita de documentos do project space quando existe `@project`.
- Quando a mensagem traz um caminho `.md` com linguagem de pedido ou confirmacao, o turno agora ganha um bloco estruturado `[project_document_intent]`.
- A skill `project-writer` foi ajustada para tratar esse bloco como o sinal mais forte sobre o alvo do documento e sobre se o usuario ja pediu/aprovou aquele arquivo.

Arquivos-chave:
- `src/chat/service.ts`
- `src/chat/service.test.ts`
- `.kael/skills/project-writer/SKILL.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/chat/service.test.ts src/skills/service.test.ts src/projects/service.test.ts`

Pendencias:
- A deteccao de confirmacao ainda e heuristica por texto; nao ha estado conversacional explicito de “proposal pending”.

Proximo passo recomendado:
- Se esse fluxo mostrar valor real, adicionar um mecanismo mais robusto de sugestao pendente por sessao sem virar approval formal pesado.

### 2026-04-04 - Project Space: API dedicada para listar, ler e escrever documentos

Resumo:
- A API ganhou endpoints nativos de project space para listar projetos, carregar contexto de projeto, listar documentos e fazer upsert de documentos.
- O `ProjectContextService` passou a expor `listProjects()` para discovery fora do chat.
- `docs/api.md` foi atualizado para refletir a nova superficie `/projects/*`.

Arquivos-chave:
- `src/api/routes/projects.ts`
- `src/api/server.ts`
- `src/projects/service.ts`
- `src/api/server.test.ts`
- `docs/api.md`

Checklist de validacao:
- [ ] `npm run check`
- [ ] `npm test -- src/api/server.test.ts src/projects/service.test.ts`

Pendencias:
- Ainda nao ha search HTTP do project space; por enquanto a busca continua disponivel via tooling do agente.
- Nao existe controle mais fino de concorrencia/merge para edicoes simultaneas de um mesmo documento.

Proximo passo recomendado:
- Adicionar um fluxo leve de confirmacao/sugestao para novos `.md` quando o modelo quiser abrir um arquivo tematico novo e depois considerar um endpoint de search em `/projects`.

### 2026-04-04 - Project Space: criacao de `.md` volta a ser guidance, nao enforcement

Resumo:
- O bloqueio estrutural de criacao de novos `.md` foi removido de `project_upsert_document`.
- A orientacao de confirmar com o usuario quando um novo arquivo parecer melhor foi mantida apenas na skill `project-writer`.
- O modelo agora tem mais liberdade operacional, mas continua orientado a preferir reutilizar documentos existentes.

Arquivos-chave:
- `src/projects/service.ts`
- `src/agents/types.ts`
- `src/agents/tool-specs/projects.ts`
- `.kael/skills/project-writer/SKILL.md`

Checklist de validacao:
- [ ] `npm run check`
- [ ] `npm test -- src/projects/service.test.ts src/chat/service.test.ts src/skills/service.test.ts src/agents/pi-tools.test.ts src/agents/tool-specs/index.test.ts`

Pendencias:
- A decisao de criar um novo `.md` ainda depende de julgamento da LLM, sem um approval flow estruturado no runtime.

Proximo passo recomendado:
- Implementar um fluxo leve de sugestao/confirmacao para novos documentos apenas quando isso melhorar a UX, sem travar o fluxo normal.

### 2026-04-04 - Project Space: remocao da superficie legada de `knowledge`

Resumo:
- O namespace `knowledge` saiu do contrato central da engine e do `KaelApp`.
- As tools PI `knowledge_search`, `knowledge_get` e `knowledge_upsert` foram removidas, assim como os endpoints `/knowledge/*` da API.
- O runtime principal agora usa apenas `projects/` como superficie de conhecimento persistido por projeto, e os arquivos legados de `src/knowledge/*` foram removidos.

Arquivos-chave:
- `src/app.ts`
- `src/agents/types.ts`
- `src/agents/pi-tools.ts`
- `src/api/server.ts`
- `docs/api.md`

Checklist de validacao:
- [ ] `npm run check`
- [ ] `npm test -- src/chat/service.test.ts src/projects/service.test.ts src/skills/service.test.ts src/agents/pi-tools.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts src/agents/simple-engine.test.ts`

Pendencias:
- Ainda faltam limpar referencias historicas a `knowledge` em documentos de status/arquitetura mais antigos.
- O fluxo de aprovacao estruturado para criar um novo `.md` ainda nao existe; a skill pede aprovacao em linguagem natural.

Proximo passo recomendado:
- Implementar o approval flow estruturado para criacao de novos documentos no project space e depois expor endpoints dedicados de `projects`.

### 2026-04-04 - Project Space: criacao de novos `.md` exige aprovacao explicita

Resumo:
- `project_upsert_document` passou a bloquear a criacao silenciosa de novos arquivos Markdown no project space.
- Novos `.md` agora exigem `allowCreate=true`, pensado para ser usado apenas quando o usuario pediu explicitamente o arquivo ou aprovou a criacao proposta pela LLM.
- A skill `project-writer` foi atualizada para priorizar reaproveitamento de documentos existentes e pedir aprovacao antes de propor um novo arquivo.

Arquivos-chave:
- `src/projects/service.ts`
- `src/projects/service.test.ts`
- `src/agents/tool-specs/projects.ts`
- `.kael/skills/project-writer/SKILL.md`

Checklist de validacao:
- [x] `npm run check`
- [ ] `npm test -- src/projects/service.test.ts src/chat/service.test.ts src/skills/service.test.ts src/agents/pi-tools.test.ts`

Pendencias:
- Ainda nao existe um fluxo de aprovacao estruturado no runtime; por enquanto a LLM precisa perguntar ao usuario em linguagem natural.
- `PROJECT.md` continua sendo criado automaticamente no scaffold do projeto, por ser parte do provisionamento base e nao um documento tematico ad hoc.

Proximo passo recomendado:
- Adicionar um pequeno protocolo de aprovacao para criacao de documento tematico e depois refletir essa politica na API do project space.

### 2026-04-04 - Project Space: `@project` como escopo explicito de turno

Resumo:
- O `ChatService` agora injeta um bloco `[project_scope]` sempre que a mensagem inclui `@project`, deixando o escopo do projeto explicito para o turno LLM.
- O `@project` passa a ser removido da pergunta base enviada ao modelo quando apropriado, reduzindo ruido e mantendo o nome do projeto em contexto estruturado em vez de texto solto.
- A skill `project-writer` foi ajustada para reutilizar `[project_scope] project=<name>` como projeto default ao ler ou escrever no project space.

Arquivos-chave:
- `src/chat/service.ts`
- `src/chat/service.test.ts`
- `.kael/skills/project-writer/SKILL.md`
- `.kael/skills/project-writer/references/schema.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/chat/service.test.ts src/projects/service.test.ts src/skills/service.test.ts src/agents/pi-tools.test.ts`

Pendencias:
- `project_upsert_document` ainda exige `project` explicito na chamada; o default hoje e de prompt/contexto, nao de schema.
- Ainda nao ha comando dedicado para inspecionar rapidamente o estado do project space de um projeto.

Proximo passo recomendado:
- Propagar o escopo do projeto tambem para a UX de escrita manual e depois decidir se a API/tooling legado de `knowledge` pode ser removido.

### 2026-04-04 - Project Space: diretorio por projeto com `PROJECT.md`, `index.json` e documentos tematicos

Resumo:
- O Kael ganhou um `project space` unificado em `.kael/projects/<project>/`, com `PROJECT.md`, `index.json` e suporte a documentos Markdown tematicos.
- Foram adicionadas tools nativas de projeto para busca, leitura, listagem e escrita (`project_search`, `project_get_document`, `project_upsert_document`, `project_list_documents`).
- O retrieval do chat para perguntas de projeto passou a usar documentos do project space como fonte principal, simplificando o modelo mental em torno de `@project`.
- A skill `project-writer` foi atualizada para escrever no project space, deixando `knowledge` como legado/compatibilidade e nao mais como superficie principal.

Arquivos-chave:
- `src/projects/service.ts`
- `src/agents/tool-specs/projects.ts`
- `src/chat/service.ts`
- `.kael/skills/project-writer/SKILL.md`
- `docs/architecture/phases/phase-18.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/projects/service.test.ts src/chat/service.test.ts src/agents/tool-specs/index.test.ts src/agents/pi-tools.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts src/agents/simple-engine.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- A API ainda nao expõe endpoints dedicados do project space.
- `knowledge` ainda existe no runtime por compatibilidade e precisa ser removido ou migrado em etapa posterior.
- A skill writer ainda nao herda automaticamente `@project` como default explicito na tool call.

Proximo passo recomendado:
- Fazer a skill writer propagar automaticamente `@project` para `project_upsert_document` e depois decidir se migra ou remove a API/tooling legado de `knowledge`.

### 2026-04-04 - Chat: escopo explicito por projeto com `@project` e `.kael/projects`

Resumo:
- O chat agora aceita `@project-name` como hint forte de escopo para perguntas sobre um projeto especifico.
- Foi adicionado um `ProjectContextService` que cria e carrega automaticamente `.kael/projects/<project>/PROJECT.md` na primeira vez em que o projeto e mencionado.
- Quando `@project` aparece, o runtime prioriza esse projeto no retrieval da knowledge base e injeta o `PROJECT.md` como contexto adicional do turno.

Arquivos-chave:
- `src/projects/service.ts`
- `src/projects/service.test.ts`
- `src/chat/service.ts`
- `src/chat/service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/projects/service.test.ts src/chat/service.test.ts src/knowledge/service.test.ts src/skills/service.test.ts src/agents/pi-tools.test.ts src/api/server.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts src/agents/simple-engine.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- O `PROJECT.md` inicial ainda e so um scaffold, sem schema/frontmatter mais forte.
- Ainda nao ha comando dedicado para listar projetos conhecidos ou preencher/curar o contexto de projeto.
- Skills ainda nao usam `@project` de forma explicita como argumento default.

Proximo passo recomendado:
- Fazer skills e writer de knowledge herdarem automaticamente o `@project` atual como default de escopo e depois adicionar um comando simples para inspecionar/provisionar projetos.

### 2026-04-04 - Chat: retrieval leve da knowledge base para perguntas de projeto

Resumo:
- O `ChatService` agora faz busca conservadora na knowledge base antes do turno LLM quando a mensagem parece uma pergunta sobre conhecimento interno de projeto.
- Quando encontra match forte, o runtime injeta um bloco `[project_knowledge_context]` com notas curadas, `kind`, `status`, `confidence`, `files` e `evidence`.
- O retrieval foi desenhado com guardrails para nao disparar em conversa generica e para instruir o modelo a tratar notas `stale`/`conflicting` com cautela explicita.

Arquivos-chave:
- `src/chat/service.ts`
- `src/chat/service.test.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/chat/service.test.ts src/knowledge/service.test.ts src/skills/service.test.ts src/agents/pi-tools.test.ts src/api/server.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts src/agents/simple-engine.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- A heuristica de entrada ainda e lexical e conservadora; ainda nao usa projeto ativo da sessao nem retrieval semantico.
- O ranking ainda depende do score atual da knowledge base, sem reforco por recencia/curation além do confidence retornado.
- Ainda nao ha modo de citar automaticamente a nota usada na resposta final de forma mais formal/estruturada.

Proximo passo recomendado:
- Melhorar o ranking com projeto ativo de sessao e depois expor, na resposta, quando o Kael usou uma nota curada como base principal.

### 2026-04-04 - Skills/Knowledge: protocolo inicial de ingestao para agentes externos

Resumo:
- A knowledge base ganhou `kind` por nota (`fact`, `analysis`, `decision`) e filtro correspondente em busca, deixando o schema de ingestao menos livre.
- Foi adicionada a skill `.kael/skills/project-writer` para orientar agentes a salvar notas com `files`, `evidence`, `confidence`, `status` e `kind`.
- A API e as tools de knowledge foram alinhadas ao novo campo `kind`, preparando a base para ingestao mais consistente por agentes de codigo.

Arquivos-chave:
- `src/knowledge/service.ts`
- `src/api/routes/knowledge.ts`
- `src/agents/tool-specs/knowledge.ts`
- `.kael/skills/project-writer/SKILL.md`
- `docs/architecture/phases/phase-18.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/knowledge/service.test.ts src/skills/service.test.ts src/agents/pi-tools.test.ts src/api/server.test.ts`

Pendencias:
- O chat ainda nao consulta automaticamente a knowledge base antes de responder perguntas de projeto.
- Ainda nao existe heuristica de conflito/staleness mais forte nem consolidacao semantica de notas proximas.
- Agentes externos ainda dependem de usar a skill ou conhecer o endpoint; nao ha endpoint de ingestao dedicado com lote/review.

Proximo passo recomendado:
- Ligar retrieval leve no fluxo do chat para perguntas de projeto e usar `kind/status/confidence` como ranking e guardrail de resposta.

### 2026-04-04 - Core: knowledge base MVP para notas curadas de projeto

Resumo:
- Foi adicionada uma knowledge base local estruturada para registrar fatos, analises e evidencias por projeto, com storage em `./.kael-data/knowledge`.
- O core ganhou `KnowledgeService` com `upsert`, `get` e `search`, persistindo nota canônica em JSON e espelho legivel em Markdown.
- O runtime do agente passou a expor `knowledge_search`, `knowledge_get` e `knowledge_upsert` no namespace `knowledge`, permitindo ingestao de achados de agentes externos ou do proprio Kael.
- A API ganhou endpoints dedicados para busca e curadoria de notas: `GET /knowledge/search`, `GET /knowledge/notes/:noteId` e `POST /knowledge/notes`.

Arquivos-chave:
- `src/knowledge/service.ts`
- `src/api/routes/knowledge.ts`
- `src/agents/tool-specs/knowledge.ts`
- `src/chat/tooling-factory.ts`
- `docs/api.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/knowledge/service.test.ts src/agents/tool-specs/index.test.ts src/agents/pi-tools.test.ts src/api/server.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts src/agents/simple-engine.test.ts`

Pendencias:
- A busca ainda e lexical; ainda nao ha retrieval semantico, consolidacao de conflitos nem revisao assistida.
- Ainda falta uma skill/protocolo explicito para agentes externos enviarem pacotes de conhecimento com schema recomendado.
- A base ainda nao participa automaticamente do fluxo de resposta do chat quando a pergunta toca conhecimento curado de projeto.

Proximo passo recomendado:
- Definir o contrato de ingestao para agentes externos e adicionar leitura assistida da knowledge base no fluxo de resposta quando houver match forte de projeto/topico.

### 2026-04-04 - Skills: base hls.js enriquecida com exemplos e parametros de segundo nivel

Resumo:
- A skill `.kael/skills/hlsjs-config-advisor` foi enriquecida com checklist de coleta de contexto, guardrails mais fortes e exemplos trabalhados de analise.
- A base local agora cobre mais parametros/documentos do `hls.js`, incluindo `frontBufferFlushThreshold`, `liveSyncDuration`, `liveMaxLatencyDuration`, `initialLiveManifestSize`, `maxStarvationDelay` e `maxLoadingDelay`.
- Foram adicionados exemplos concretos de resposta para cenarios como `live` sem sintoma claro, conflito formal de config, device com pressao de memoria e startup ruim com `startLevel` alto.

Arquivos-chave:
- `.kael/skills/hlsjs-config-advisor/SKILL.md`
- `.kael/skills/hlsjs-config-advisor/references/parameter-catalog.md`
- `.kael/skills/hlsjs-config-advisor/references/analysis-playbook.md`
- `.kael/skills/hlsjs-config-advisor/references/worked-examples.md`

Checklist de validacao:
- [x] `npm test -- src/skills/service.test.ts`

Pendencias:
- Ainda faltam exemplos com logs/telemetria reais cruzando config e sintomas.
- Ainda nao ha segmentacao explicita por versao do `hls.js` dentro da base.

Proximo passo recomendado:
- Adicionar exemplos reais de review com manifest/playback logs e depois versionar a base por release relevante do `hls.js`.

### 2026-04-04 - Video: advisor inicial de parametros para playback HLS

Resumo:
- A direcao do advisor de `hls.js` foi corrigida: em vez de capability hardcoded no core, o conhecimento agora vive em uma skill local do workspace.
- Foi adicionada a skill `.kael/skills/hlsjs-config-advisor`, com base curada a partir de fontes oficiais do `hls.js` (`docs/API.md`, `src/config.ts` e API docs do site).
- O advisor passa a depender de leitura contextual de defaults, conflitos formais e tradeoffs, em vez de heuristicas fixas no TypeScript.
- O hardcoded inicial de `playback_config_advise` foi removido do core para evitar duplicar conhecimento especializado dentro do runtime.

Arquivos-chave:
- `.kael/skills/hlsjs-config-advisor/SKILL.md`
- `.kael/skills/hlsjs-config-advisor/references/parameter-catalog.md`
- `.kael/skills/hlsjs-config-advisor/references/parameter-interactions.md`
- `src/skills/service.test.ts`
- `docs/architecture/phases/phase-20.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/skills/service.test.ts src/agents/tool-specs/index.test.ts src/agents/pi-tools.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- A skill hoje cobre apenas `hls.js`.
- Ainda falta integrar sintomas observados (`PlaybackAnalysisReport`) de forma mais explicita no fluxo de analise recomendado.
- A base oficial foi curada localmente; ainda nao existe pipeline de refresh por versao do player.

Proximo passo recomendado:
- Enriquecer a skill com exemplos de analise de config real e depois criar skills equivalentes para `shaka`, `AVPlayer` e `ExoPlayer`.

### 2026-04-04 - Video: manifest diff inicial e CLI local

Resumo:
- Adicionada a capability `VideoManifestDiffService`, que compara dois audits HLS e devolve delta de stats, mudanca de `playlistType` e issues adicionadas/removidas.
- O diff agora compara tambem variants/ladders em memoria, com matching explicito e classificacao de regressao/melhoria por variant.
- O diff passou a calcular `regressionScore`/`regressionSeverity` por variant e emitir recomendacoes especificas quando mudam `audioGroupId` ou `subtitlesGroupId`.
- O runtime PI ganhou a tool `video_manifest_diff`, e a CLI ganhou o comando `manifest-diff`.
- `KaelApp`, bootstrap e chat tooling agora expõem o diff de manifesto como parte nativa do dominio de video QA.

Arquivos-chave:
- `src/capabilities/video/manifest-diff-service.ts`
- `src/capabilities/video/types.ts`
- `src/chat/tooling-factory.ts`
- `src/agents/tool-specs/video.ts`
- `src/cli/index.ts`
- `docs/architecture/phases/phase-20.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/manifest-diff-service.test.ts src/capabilities/video/jobs/job-capability.test.ts src/capabilities/video/jobs/job-service.test.ts src/capabilities/video/jobs/safety.test.ts src/agents/tool-specs/index.test.ts src/agents/pi-tools.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- O diff ainda compara o snapshot de audit em memoria; ainda nao ha comparacao baseada em artifacts persistidos.
- Ainda nao existe diff equivalente para DASH.
- Ainda faltam heuristicas mais profundas por variant, como diff dedicado de renditions/grupos completos e score agregado de severidade da ladder inteira.

Proximo passo recomendado:
- Integrar o novo advisor de configuracao com `playback_analyze` e depois voltar a decidir se faz sentido persistir audits para diff historico.

### 2026-04-04 - Video: subdominio jobs explicitado dentro da capability

Resumo:
- O bloco operacional de jobs de video foi movido para `src/capabilities/video/jobs`, separando melhor a borda de execucao (`JobManager`/ffmpeg/ffprobe) do restante do dominio de video.
- A adaptacao para o `JobManager` foi renomeada para `VideoJobCapability`, refletindo com mais precisao o papel do registro de acoes de job.
- O barrel de `src/capabilities/video/index.ts` continua reexportando os contratos principais para evitar quebra desnecessaria no restante do core.

Arquivos-chave:
- `src/capabilities/video/jobs/job-capability.ts`
- `src/capabilities/video/jobs/job-service.ts`
- `src/capabilities/video/jobs/job-contracts.ts`
- `src/capabilities/video/jobs/safety.ts`
- `src/capabilities/video/index.ts`
- `docs/architecture/phases/phase-20.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/jobs/job-capability.test.ts src/capabilities/video/jobs/job-service.test.ts src/capabilities/video/jobs/safety.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- Ainda existe acoplamento semantico entre validacoes de job (`jobs/safety.ts`) e `inspect-service.ts` via `validateStreamUrl`.
- O proximo incremento funcional de maior valor continua sendo `video_manifest_diff`.

Proximo passo recomendado:
- Implementar `video_manifest_diff` reaproveitando `VideoManifestAuditService` e `StoredArtifactRecord`, sem reabrir mais refactors estruturais antes disso.

### 2026-04-04 - Core: modos de execucao explicitos no tooling

Resumo:
- O wiring de `createChatTooling` passou a usar nomes de executor explicitos (`jobManager`, `shellRuntime`, `edgeRuntime`, `browserRuntime`) em vez de dependencias ambigamente chamadas de capability.
- Browser saiu de `src/capabilities/browser` para `src/runtime/browser`, e o core agora depende direto de `BrowserRuntime`.
- Foi adicionado um catalogo central de namespaces com `executionMode` para documentar a diferenca entre `job`, `interactive`, `remote` e `service`.

Arquivos-chave:
- `src/chat/tooling-factory.ts`
- `src/bootstrap/runtime.ts`
- `src/runtime/browser/service.ts`
- `src/agents/tooling-descriptors.ts`
- `docs/architecture/phases/phase-16.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/runtime/browser/runtime.test.ts src/runtime/browser/presentation.test.ts src/runtime/browser/service.test.ts src/agents/tool-specs/index.test.ts src/agents/pi-tools.test.ts`

Pendencias:
- O catalogo de descriptors ainda nao e consumido por `/health`, docs geradas ou introspeccao em runtime.
- Ainda existem usos historicos do termo "capability" no PI/tool-specs que podem ser simplificados depois.

Proximo passo recomendado:
- Expor os descriptors de namespace em uma superficie observavel do core e alinhar a documentacao operacional do engine com esses modos de execucao.

### 2026-04-03 - Video: manifest audit expandido em memoria para variants

Resumo:
- `VideoManifestAuditService` agora consegue descer opcionalmente nas media playlists das variants de uma master playlist sem persistir artifacts.
- O relatorio passou a incluir `variantAudits`, `aggregateIssues`, `variantsAudited` e `variantsWithErrors` para diagnostico da ladder inteira.
- O CLI `manifest-audit` ganhou `--follow-variants` e `--max-variants`, e a tool `video_manifest_audit` passou a aceitar esses parametros.

Arquivos-chave:
- `src/capabilities/video/manifest-audit-service.ts`
- `src/capabilities/video/types.ts`
- `src/cli/index.ts`
- `src/agents/tool-specs/video.ts`
- `docs/architecture/phases/phase-20.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/manifest-audit-service.test.ts src/agents/tool-specs/index.test.ts src/agents/pi-tools.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- Ainda nao ha persistencia opcional dos manifests auditados para diff/historico.
- Os `aggregateIssues` ainda cobrem um conjunto inicial de heuristicas, sem score de qualidade mais avancado da ladder.
- Ainda nao ha follow equivalente para DASH.

Proximo passo recomendado:
- Adicionar persistencia opcional (`--save`) para evidencias brutas/normalizadas e depois implementar `video_manifest_diff` sobre esses artifacts.

### 2026-04-03 - Video: capability inicial de manifest audit para HLS

Resumo:
- Adicionada a capability `VideoManifestAuditService` para transformar inspect bruto de HLS em diagnostico orientado a QA e operacao.
- O runtime PI ganhou a tool `video_manifest_audit`, exposta no namespace `video` do engine.
- O audit cobre checks iniciais de master/media playlist, ladder, grupos de audio, `TARGETDURATION` e consistencia dos primeiros segmentos.

Arquivos-chave:
- `src/capabilities/video/manifest-audit-service.ts`
- `src/capabilities/video/types.ts`
- `src/agents/tool-specs/video.ts`
- `src/chat/tooling-factory.ts`
- `src/bootstrap/runtime.ts`
- `docs/architecture/phases/phase-20.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/capabilities/video/manifest-audit-service.test.ts src/agents/tool-specs/index.test.ts src/agents/pi-tools.test.ts`

Pendencias:
- Ainda nao ha auditoria equivalente para DASH.
- Ainda falta um diff de manifesto entre duas versoes/ambientes.
- O planner ainda nao consome esse relatorio como assert automatizado.

Proximo passo recomendado:
- Evoluir a trilha de video QA com `video_manifest_diff` e depois integrar `manifest_audit` como validacao reutilizavel no planner.

### 2026-04-03 - Refactor: tooling do engine modular por namespaces

Resumo:
- O contrato flat legado de tooling do engine foi removido do runtime e dos testes.
- `src/agents/types.ts` passou a expor contratos reais por namespace (`video`, `jobs`, `system`, `mcp`, `edge`, `memory`, `workspace`, `web`, `browser`, `image`, `plans`).
- `ChatService`, `SimpleCommandEngine`, `pi-tools` e `tool-specs` agora consomem `EngineToolingNamespaces` de ponta a ponta, sem adapter de flatten/resolve.

Arquivos-chave:
- `src/agents/types.ts`
- `src/chat/tooling-factory.ts`
- `src/chat/service.ts`
- `src/agents/pi-tools.ts`
- `src/agents/simple-engine.ts`
- `docs/architecture/phases/phase-19.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/agents/simple-engine.test.ts src/agents/pi-tools.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts src/api/server.test.ts`

Pendencias:
- Ainda existem referencias historicas a `EngineTooling` flat em diagramas e registros antigos do status.
- Falta avaliar se vale quebrar `src/agents/types.ts` em arquivos menores por dominio para reduzir densidade do contrato central.

Proximo passo recomendado:
- Continuar a simplificacao estrutural extraindo tipos/tool contracts por modulo de dominio e revisar os hotspots restantes (`PiEngineAdapter` e planner runtime) com a mesma abordagem.

### 2026-03-29 - Youbora: rawdata/events e rota explicita /youbora

Resumo:
- Adicionados wrappers dedicados `youbora_rawdata_get` e `youbora_events_get` sobre capabilities remotas do Clark/MCP.
- O fast-path operacional ganhou rota explicita `/youbora` com subcomandos `metrics`, `rawdata` e `events`.
- O consumo do Youbora ficou menos dependente da escolha autonoma do modelo e mais previsivel para operacao/manual test.

Arquivos-chave:
- `src/agents/tool-specs/edge.ts`
- `src/agents/pi-tools.ts`
- `src/agents/simple-engine.ts`
- `src/agents/types.ts`
- `src/chat/tooling-factory.ts`
- `docs/architecture/phases/phase-21.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/agents/simple-engine.test.ts src/agents/pi-tools.test.ts src/agents/tool-specs/index.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts`

Pendencias:
- Ainda falta definir um contrato mais ergonomico para filtros complexos do Youbora, evitando `filtersJson` cru nos subcomandos.
- Ainda nao ha persistencia/observabilidade dedicada para consultas edge do Youbora.

Proximo passo recomendado:
- Adicionar um parser/contrato mais amigavel para filtros comuns do Youbora e registrar execucoes edge em trilha operacional persistente.

### 2026-03-29 - Youbora: remover heuristica lexical no adapter

Resumo:
- Removido o roteamento por substring (`isYouboraQuestion`) do `pi-engine-adapter`.
- A integracao do Youbora continua disponivel pela tool dedicada e pelo catalogo de capabilities/skills, sem lista hardcoded de palavras no adapter.
- Mantido o principio de descoberta por tools/contratos em vez de inferencia lexical fragil.

Arquivos-chave:
- `src/agents/pi-engine-adapter.ts`

Checklist de validacao:
- [x] `npm run check`

Pendencias:
- Ainda falta evoluir a experiencia do agente para escolher a tool do Youbora com base em contexto/tool descriptions, sem heuristicas ad hoc.

Proximo passo recomendado:
- Se necessario, melhorar descricoes/system prompt das tools do edge/Youbora em vez de reintroduzir detectores lexicais.

### 2026-03-29 - Youbora via Clark/MCP: wrapper dedicado no Kael

Resumo:
- Confirmado o caminho de integracao via Clark/MCP usando capabilities declaradas no `clark.config.json` real da maquina, em vez de criar capability HTTP nova no Clark.
- O PI/Kael ganhou a tool dedicada `youbora_metrics_get`, wrapper tipado sobre `edge_call` para a capability remota `youbora.metrics.get`.
- O `pi-engine-adapter` agora prioriza `youbora_metrics_get` quando detecta perguntas sobre Youbora/NPAW.
- A skill local `youbora` foi atualizada para preferir Clark/MCP e usar o script HTTP/MD5 apenas como fallback.

Arquivos-chave:
- `src/agents/tool-specs/edge.ts`
- `src/agents/pi-tools.ts`
- `src/agents/pi-engine-adapter.ts`
- `.kael/skills/youbora/SKILL.md`
- `docs/architecture/phases/phase-21.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/agents/pi-tools.test.ts src/agents/tool-specs/index.test.ts src/api/server.test.ts`

Pendencias:
- Ainda falta wrapper dedicado para outras capabilities do MCP do Youbora (`rawdata`, `events`, `metrics_help`, `filters_help`).
- O sucesso end-to-end depende do `clark.config.json` real ter a capability `youbora.metrics.get` ativa e o Clark conectado.

Proximo passo recomendado:
- Adicionar wrappers dedicados para `youbora.rawdata.get` e `youbora.events.get`, ou um contrato de consulta mais completo cobrindo filtros comuns do time.

### 2026-03-29 - Edge/Clark: dispatch remoto baseline no Kael

Resumo:
- `EdgeRuntime` do Kael deixou de ser apenas registry/heartbeat e passou a despachar `server.task.request` com correlacao por `taskId`, timeout e reconciliacao de `client.task.result`.
- `KaelApp` agora expoe runtime edge compartilhado entre app, API e tooling de chat/PI.
- O agente ganhou tools genericas `edge_list` e `edge_call` para listar capabilities remotas e executar uma capability via Clark.
- Cobertura de testes atualizada com roundtrip WebSocket real entre Kael e Clark no fluxo `task_request/task_result`.

Arquivos-chave:
- `src/edge/runtime.ts`
- `src/edge/protocol.ts`
- `src/api/server.ts`
- `src/chat/tooling-factory.ts`
- `src/agents/tool-specs/edge.ts`
- `src/agents/pi-tools.ts`
- `src/api/server.test.ts`
- `docs/architecture/phases/phase-21.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/api/server.test.ts src/agents/pi-tools.test.ts src/agents/tool-specs/index.test.ts`

Pendencias:
- Ainda nao existe capability de negocio dedicada para Youbora/NPAW; o baseline atual e generico.
- Execucoes remotas ainda nao entram na trilha persistente de jobs/observabilidade do Kael.
- Ainda falta auth/approval entre Kael e Clark.

Proximo passo recomendado:
- Implementar a primeira capability remota de negocio (Youbora/NPAW) por cima de `edge_call`, com contrato dedicado e rastreabilidade operacional.

## Roadmap de Fases

### Fase 0 - Foundation

Status: **Concluida**

Entregas:
- Estrutura inicial em TypeScript/Node.
- Config central (`KAEL_PORT`, `KAEL_HOST`, `KAEL_DATA_DIR`).
- App bootstrap com composicao de servicos.

Definition of Done (checklist):
- [x] Projeto sobe localmente via CLI/API.
- [x] Typecheck configurado em modo strict.
- [x] Estrutura de pastas base definida.
- [x] Configuracao centralizada por env.

### Fase 1 - Core Loop (CLI + API + Session + Job Basico)

Status: **Concluida**

Entregas:
- API Fastify:
  - `GET /health`
  - `POST /chat`
  - `GET /sessions/:sessionKey/messages`
  - `POST /jobs/transcode`
  - `GET /jobs`
  - `GET /jobs/:jobId`
  - `GET /jobs/:jobId/log`
- CLI:
  - `server`
  - `chat --message`
  - `jobs`
- Session Store:
  - index em JSON
  - transcript append-only em JSONL por sessao
- Job Store:
  - persistencia de jobs em JSON
  - logs por job em arquivo dedicado
- Tooling:
  - `ProcessRunner` (abstracao)
  - `LocalProcessRunner` (execucao local)
  - `TranscodeService` assíncrono com ffmpeg
- Engine:
  - interface `AgentEngine`
  - implementacao inicial `SimpleCommandEngine`

Pendencias desta fase:
- Sem dedupe/idempotency ainda.
- Sem retries/backoff ainda.
- Sem testes automatizados ainda.

Definition of Done (checklist):
- [x] Endpoint de chat funcional (`POST /chat`).
- [x] Sessao persistida com transcript JSONL.
- [x] CLI operacional para chat e jobs.
- [x] Job assíncrono de transcode com log persistente.
- [x] Contrato de engine desacoplado (`AgentEngine`).
- [ ] Testes automatizados desta fase.

### Fase 2 - Engine Real + Tooling de Video

Status: **Em andamento**

Objetivos:
- Criar `PiEngineAdapter` (ou adapter equivalente).
- Manter fallback local para comandos basicos.
- Expandir tools de video:
  - `convertHLS`
  - `captureStream`
  - `probeMedia`

Definition of Done (checklist):
- [x] `PiEngineAdapter` integrado ao contrato `AgentEngine`.
- [x] `SimpleCommandEngine` mantido como fallback operacional.
- [x] `convertHLS` implementado e testado manualmente.
- [x] `captureStream` implementado e testado manualmente.
- [x] `probeMedia` implementado e testado manualmente.
- [x] Atualizacao de docs de uso de tools no README/STATUS.
- [ ] Adicionar testes automatizados para as novas tools.

### Fase 3 - Resiliencia Operacional

Status: **Concluida**

Objetivos:
- Retry com backoff + jitter.
- Classificacao de erro e fallback de modelo.
- Guard de contexto e reset de sessao em falhas irrecoveraveis.
- Dedupe/idempotency para requests.

Definition of Done (checklist):
- [x] Retry utilitario com politicas configuraveis.
- [x] Fallback classificado por tipo de erro.
- [x] Guard de contexto aplicado antes de chamada de modelo.
- [x] Reset automatico de sessao para falhas fatais.
- [x] Dedupe/idempotency ativo nos endpoints criticos.

### Fase 4 - Autonomia (Heartbeat + Cron)

Status: **Concluida**

Objetivos:
- Heartbeat produtivo (nao so ACK).
- Scheduler cron persistente com catch-up.
- Notificacao de mudancas relevantes de jobs.

Definition of Done (checklist):
- [x] Heartbeat executando em intervalo configuravel.
- [x] Resposta silenciosa quando nao houver acao.
- [x] Cron persistente com recuperacao apos restart.
- [x] Monitoramento de jobs com notificacoes relevantes.
- [x] API/CLI para listar e gerenciar schedules.
- [x] Suporte inicial a cron expression para schedules.

### Fase 5 - Hardening e Observabilidade

Status: **Concluida**

Objetivos:
- Testes (unit/integration/e2e).
- Logs estruturados e health mais rico.
- Politicas de seguranca de execucao.

Definition of Done (checklist):
- [x] Suite minima de testes unitarios para stores/engine/jobs.
- [x] Testes de integracao de API (chat + jobs).
- [x] Logs estruturados com contexto de sessao/job.
- [x] Health endpoint com sinais operacionais.
- [x] Politica de execucao segura documentada e aplicada.

### Fase 6 - Shell Power no PI (exec/process + approvals)

Status: **Concluida**

Objetivos:
- Dar capacidade real de shell para o Kael em `pi`/`hybrid`.
- Permitir controle de processos em background (`list/poll/kill`).
- Aplicar politica de seguranca e aprovacao persistida em `~/.kael`.

Definition of Done (checklist):
- [x] Tool `exec` integrada ao PI.
- [x] Tool `process` integrada ao PI.
- [x] Timeout + limite de output + `cwd` restrito ao workspace.
- [x] Politica `deny|allowlist|full` e `ask=off|on-miss|always`.
- [x] Persistencia de approvals em `~/.kael/exec-approvals.json`.
- [x] Testes unitarios de policy/approvals.

### Fase 7 - Guardrails de Loop (exec/process)

Status: **Concluida**

Objetivos:
- Evitar loops de tool calling sem progresso em `exec` e `process`.
- Reduzir custo e latencia em fluxos com polling/repeticao.

Definition of Done (checklist):
- [x] Detector de repeticao/no-progress no runtime PI.
- [x] Bloqueio temporario com cooldown e mensagem explicita para o agente.
- [x] Testes unitarios cobrindo bloqueio e casos de progresso.
- [x] Context guard com auto-compaction de historico antes de estourar contexto.
- [ ] Tuning de thresholds e qualidade de resumo com telemetria real de uso.

### Fase 8 - Memoria Operacional (longo prazo)

Status: **Em andamento**

Objetivos:
- Dar memoria persistente local ao Kael para fatos, preferencias e decisoes.
- Expor ferramentas explicitas de recall/escrita para o PI.

Definition of Done (checklist):
- [x] Persistencia em `MEMORY.md` (duravel) e `memory/YYYY-MM-DD.md` (diaria).
- [x] Tools `memory_search`, `memory_get` e `memory_write` integradas ao PI.
- [x] Leitura restrita de memoria para paths permitidos.
- [x] Testes unitarios de escrita, busca e seguranca de path.
- [x] Planner/executor baseline com plano persistido e tools de plano no PI.
- [x] Planner inteligente inicial com `plan_generate` (objetivo -> plano heuristico).
- [x] Checkpoints por etapa no planner (historico de transicoes + notas acumuladas).
- [x] Executor assistido (`plan_execute_next`) com vinculo de step para `job/exec`.
- [x] Reconciliacao automatica (`planner.reconcile`) sincronizando step com status final de runtime.
- [ ] Tuning de ranking/recencia e qualidade de snippets.
- [ ] Reduzir latencia de reconciliacao com stream/eventos (SSE) em vez de polling.

### Fase 9 - Research Web (API-first)

Status: **Em andamento**

Objetivos:
- Dar capacidade de pesquisa web com fontes citadas no loop do agente.
- Manter arquitetura plugavel por provider, com custo operacional baixo.
- Persistir trilha de pesquisa por sessao para auditoria/continuidade.

Definition of Done (checklist):
- [x] Tool `web_search` integrada ao PI.
- [x] Tool `web_fetch` integrada ao PI.
- [x] Tool `web_research` integrada ao PI.
- [x] Provider API-first inicial (`tavily`) com contrato plugavel.
- [x] Memoria de pesquisas por sessao em arquivo local.
- [x] Cache de fetch por URL com TTL configuravel.
- [x] Configuracao `KAEL_RESEARCH_*` documentada e validada no startup.
- [x] Sumarizacao multi-fonte com evidencia e score de confianca.
- [ ] Suporte opcional a multiplos providers.

### Fase 10 - Compaction + Memory Flush (curadoria de memoria)

Status: **Concluida**

Objetivos:
- Tornar compaction um fluxo explicito e testavel (`/compact`).
- Introduzir memory flush para `daily` antes de compactar contexto.
- Criar base para promocao futura de fatos para `MEMORY.md`.

Definition of Done (checklist):
- [x] Comando manual `/compact` no chat para disparar compactacao sob demanda.
- [x] Memory flush MVP para `memory/YYYY-MM-DD.md` (append) antes da compactacao manual.
- [x] Resposta de status com resultado de flush/compact (facilita teste/manual tuning).
- [x] Memory flush guiado por LLM (com fallback heuristico local).
- [x] Compaction automatica por limiar com memory flush pre-compaction.
- [x] Promocao de fatos duraveis para `MEMORY.md` no fluxo de compactacao (LLM-guided).
- [x] Dedupe textual basico na escrita de `memory_write(target=long_term)`.
- [x] Ranking de evidencia (relevancia, fonte, recencia, fetch, diversidade).
- [x] Deduplicacao semantica.

### Fase 11 - Reply Orchestrator Lite (comandos determinísticos)

Status: **Concluida**

Objetivos:
- Garantir fast-path deterministico para comandos operacionais no chat.
- Reduzir dependencia do LLM para operacoes de controle (`/jobs`, `/probe`, `/transcode`, etc.).
- Preparar base para auto-reply incremental sem acoplar multi-canal.

Definition of Done (checklist):
- [x] Fast-path de slash commands no `ChatService` (incluindo modo `pi`).
- [x] Extrair roteador de comandos para modulo dedicado com testes unitarios.
- [x] Telemetria de fast-path vs turno LLM em eventos/logs.

### Fase 12 - Supervisor de Execucao Shell (determinismo operacional)

Status: **Concluida**

Objetivos:
- Unificar lifecycle de `exec/process` em supervisor dedicado.
- Tornar timeout/cancelamento mais deterministico sob carga.
- Reduzir superficie de erro em polling e limpeza de sessoes.

Definition of Done (checklist):
- [x] Supervisor dedicado para sessoes de shell e transicoes de estado.
- [x] API `process` apoiada em snapshot consistente por supervisor.
- [x] Testes de corrida/cancelamento/timeout em cenarios concorrentes.

### Fase 13 - Fechamento de Qualidade de Video Runtime

Status: **Planejada**

Objetivos:
- Fechar pendencias de automacao de testes da Fase 2 (tools de video).
- Reforcar cobertura de cenarios invalidos/limites nas tools de inspecao e jobs.

Definition of Done (checklist):
- [ ] Cobertura automatizada para `video-inspect-tool-service`.
- [ ] Cobertura adicional de seguranca/validacao de params de video.
- [ ] Execucao de `npm run check` + suite alvo de video em CI/local.

### Fase 14 - Email Ingress MVP (conta dedicada)

Status: **Em andamento**

Objetivos:
- Permitir inbox dedicada para o Kael com ingest de novos emails no loop do agente.
- Preservar arquitetura desacoplada para evoluir de polling POP3 para push (Gmail Pub/Sub) sem quebrar o core.

Definition of Done (checklist):
- [x] Contrato `EmailProvider` + `EmailIngestService` desacoplados do core.
- [x] Provider inicial `gmail_pop3` com estado de mensagens vistas.
- [x] Scheduler persistente com job `email_poll`.
- [x] Guard de concorrencia para evitar duplicacao por ticks sobrepostos.
- [x] Auto-reply opcional via SMTP Gmail (`KAEL_EMAIL_AUTO_REPLY_ENABLED`).
- [ ] Evoluir provider push (Gmail API/PubSub) mantendo o mesmo contrato.

### Fase 15 - Multimodal Ingress MVP (imagem/audio)

Status: **Em andamento**

Objetivos:
- Permitir entrada multimodal em canais suportados sem acoplar ao canal.
- Introduzir contrato canônico de anexos no core e manter backward compatibility.
- Preparar base para etapa seguinte de entendimento multimodal por provider.

Definition of Done (checklist):
- [x] Contrato de anexos (`image|audio`) no fluxo core (`ChatService`/`EngineTurnInput`).
- [x] `POST /chat` aceitando anexos opcionais no formato canônico.
- [x] Discord ingerindo anexos de imagem/audio com limites de download/tamanho.
- [x] Persistencia de hint de anexos no transcript da sessao.
- [x] `MediaUnderstandingService` (descricao de imagem + transcricao de audio).
- [x] Injecao do resultado multimodal no contexto do turno.
- [x] Metricas operacionais multimodais no `/health`.

### Fase 16 - Browser Control para teste de sites

Status: **Em andamento**

Objetivos:
- Introduzir controle de browser por tool dedicada no runtime PI.
- Entregar automacao web incremental (read-only -> interacao) com observabilidade no `/health`.
- Manter arquitetura simples e desacoplada no contrato namespaced `EngineToolingNamespaces`.

Definition of Done (checklist):
- [x] Foundations: contrato/wiring/config/telemetria base de browser runtime.
- [x] Read-only: `start|open|navigate|snapshot_text|screenshot|close`.
- [x] Interacao: `click|type|press|wait_for`.
- [x] Hardening: cleanup de sessoes, budget anti-loop e metrica por acao/erro.
- [x] UX operacional: atalhos `/browser-*` no fast-path + guia de uso CLI/chat.

### Fase 17 - Orquestracao de Planos v2

Status: **Em andamento**

Objetivos:
- Evoluir planos para suportar controle operacional de lifecycle (`wait`, `approve`, `cancel`) de execucoes.
- Adicionar etapas de validacao de saida para reduzir falso-positivo de "executou mas nao entregou".
- Introduzir branching leve de falha (`retry|skip|stop`) com limite de tentativas por step.

Definition of Done (checklist):
- [x] Novas acoes de controle de execucao no planner (`wait_execution`, `cancel_execution`).
- [ ] Completar action de controle pendente (`approve_execution`).
- [ ] Novas acoes de validacao (`assert_file_exists`, `assert_hls_ok`, `assert_duration`).
- [ ] `on_fail` + `maxRetries` por step com persistencia no plano.
- [ ] Telemetria de retries/falhas de plano no `/health` e logs estruturados.
- [ ] Atualizacao de docs de arquitetura/API/PI tools para a nova superficie de actions.

### Fase 18 - Skills no Core (`.kael/skills`)

Status: **Em andamento**

Objetivos:
- Introduzir skills em arquivo (`SKILL.md`) com discovery nativo em `.kael/skills`.
- Permitir invocacao manual por slash command e auto-invocacao controlada por frontmatter/descricao.
- Manter prompt enxuto com carga lazy do conteudo completo da skill apenas quando necessario.
- Preservar seguranca operacional (sem ampliar permissoes de tools alem da policy global).

Definition of Done (checklist):
- [x] `SkillDiscoveryService` + parser de frontmatter em `SKILL.md`.
- [x] Registro de skills com metadados minimos (`name`, `description`, flags de invocacao).
- [x] Invocacao manual `/<skill-name> [args]` integrada ao fast-path.
- [x] Auto-invocacao com no maximo 1 skill por turno e carga lazy do conteudo completo.
- [x] Suporte a substituicoes basicas de argumentos (`$ARGUMENTS`, `$0`, `$1`...).
- [x] Telemetria inicial de skills em `/health`.
- [x] Documentacao operacional de skills (estrutura de pastas + exemplos) no repo.

### Fase 19 - MCP Bridge via `mcporter`

Status: **Em andamento**

Objetivos:
- Adicionar suporte operacional a MCP sem embutir runtime MCP no core do Kael.
- Expor tools dedicadas de MCP no PI (`mcp_list`, `mcp_call`) com guardrails.
- Reusar o padrao do OpenClaw: bridge externa via `mcporter` + skill operacional.

Definition of Done (checklist):
- [x] `McpBridgeService` com `list/call`, timeout, parsing JSON e truncamento de output.
- [x] Configuracao base por ENV (`KAEL_MCP_*`) integrada ao app.
- [x] Wiring em `EngineToolingNamespaces` + `createChatTooling`.
- [x] Tools PI `mcp_list` e `mcp_call`.
- [x] Skill operacional `.kael/skills/mcporter/SKILL.md`.
- [x] Registry persistente de servidores MCP permitidos.
- [x] Approvals persistentes por servidor/transport.
- [x] Telemetria dedicada de MCP no `/health`.
- [ ] Fluxos de `auth/config` do `mcporter` com policy explicita.

### Fase 20 - Video Intelligence Platform

Status: **Em andamento**

Objetivos:
- Evoluir o Kael para analise de playback, geracao multimidia e persistencia de evidencia no dominio de video.
- Preservar `video` como capability principal, expandindo por subservicos e adapters plugaveis.
- Preparar base para players (`AVPlayer`, `ExoPlayer`, `hls.js`, `Shaka`) e providers de geracao (`Veo`, `Seedance`, etc.) sem acoplamento estrutural.

Definition of Done (checklist):
- [x] Tipos canônicos iniciais para playback/generation/artifacts.
- [x] `PlaybackTriageService` com heuristicas baseline para sessoes de player.
- [x] `VideoArtifactsService` para persistir outputs gerados e metadata.
- [x] `VideoGenerationService` inicial reaproveitando provider atual de image generation.
- [ ] Tools PI dedicadas (`video_generate_image`, `video_dash_inspect`, `video_manifest_diff`).
- [x] Tool PI `playback_analyze` com contrato text-first (`logText`) e suporte opcional a eventos estruturados.
- [ ] Adapters por player (`hlsjs`, `shaka`, `exoplayer`, `avplayer`) com normalizacao de eventos.
- [ ] Adapters por player (`shaka`, `exoplayer`, `avplayer`) com normalizacao de eventos.
- [x] Adapter inicial de `hlsjs` com parsing text-first e heuristicas de erro/ABR.
- [ ] Provider(s) reais de video generation plugados no novo contrato.
- [ ] Integracao de validacoes de playback/video QA ao planner.

### Fase 21 - Clark Runtime Satelite (capacidades de ambiente)

Status: **Concluida**

Objetivos:
- Incubar um projeto separado em `apps/clark` para atuar como runtime satelite do Kael.
- Permitir execucao de capacidades disponiveis em ambientes especificos, sem acoplar o runtime do Kael a um host, rede, MCP ou contexto operacional particular.
- Validar o fluxo minimo ponta a ponta: registro, heartbeat, task dispatch e retorno estruturado de resultados.

Definition of Done (checklist):
- [x] `apps/clark` criado com `package.json`, `tsconfig.json`, `README.md` e estrutura propria de `src/`.
- [x] CLI inicial com `daemon`, `status` e `capabilities`.
- [x] Protocolo WebSocket minimo tipado e validado em runtime (`register`, `heartbeat`, `task_request`, `task_result`).
- [x] Conexao outbound com reconexao/backoff e logs estruturados.
- [x] Registry de capabilities e `task executor` desacoplados.
- [x] Capabilities MVP implementadas (`system.info`, `network.check`, `internal.http.fetch` restrita).
- [x] Suite inicial de testes unitarios e ao menos um teste de integracao com servidor WS fake.

## Registro de Atualizacoes por Commit

### 2026-03-28 - Fase 21.0: bootstrap funcional do Clark runtime satelite em apps/clark

Resumo:
- Criado `apps/clark` como projeto incubado separado, com CLI propria, build, check, testes e README.
- Implementado daemon MVP com WebSocket outbound, `register`, `heartbeat`, task dispatch, reconexao/backoff e logs estruturados.
- Entregues registry de capabilities, executor de capacidades de ambiente e capabilities iniciais `system.info`, `network.check` e `internal.http.fetch`.

Arquivos-chave:
- `apps/clark/package.json`
- `apps/clark/src/core/edge-client.ts`
- `apps/clark/src/core/connection-manager.ts`
- `apps/clark/src/core/task-executor.ts`
- `apps/clark/src/protocol/types.ts`
- `apps/clark/src/capabilities/internal-http-fetch.ts`
- `apps/clark/src/tests/integration.test.ts`
- `docs/architecture/phases/phase-21.md`

Checklist de validacao:
- [x] `npm --prefix apps/clark run check`
- [x] `npm --prefix apps/clark run test`

Pendencias:
- Ainda nao ha autenticacao, approval local nem capability real de negocio como Youbora.
- O projeto ainda nao possui `package-lock.json` proprio porque o bootstrap foi validado reaproveitando as dependencias ja presentes no workspace.

Proximo passo recomendado:
- Implementar a primeira capability real de negocio orientada a ambiente remoto especifico, comecando por um adapter como `youbora.session.fetch`.

### 2026-03-28 - Fase 21.1: bindings explicitos para MCP HTTP corporativo no Clark

Resumo:
- Adicionado suporte a discovery de providers MCP HTTP configurados localmente no Clark.
- Introduzido modelo de bindings explicitos `capability -> mcp tool`, preservando o Kael orientado a capabilities e nao a um MCP generico.
- O `register` do client agora inclui metadados resumidos de providers MCP HTTP disponiveis, e o executor de capacidades de ambiente ja consegue chamar tools MCP por HTTP JSON-RPC.

Arquivos-chave:
- `apps/clark/src/mcp/http-client.ts`
- `apps/clark/src/mcp/capability-provider.ts`
- `apps/clark/src/config/settings.ts`
- `apps/clark/src/protocol/types.ts`
- `apps/clark/src/tests/mcp-http-client.test.ts`
- `apps/clark/src/tests/mcp-capability-provider.test.ts`
- `docs/architecture/phases/phase-21.md`

Checklist de validacao:
- [x] `npm --prefix apps/clark run check`
- [x] `npm --prefix apps/clark run test`
- [x] `npm --prefix apps/clark run build`

Pendencias:
- Os bindings MCP ainda usam schema generico de input (`object passthrough`), sem contratos estritos por capability.
- Ainda nao ha um binding real de negocio ja configurado no repo, apenas a infraestrutura e o fluxo.

Proximo passo recomendado:
- Criar o primeiro binding corporativo real, por exemplo `corp.session.fetch`, com input/output tipados e contrato alinhado ao MCP da empresa.

### 2026-03-28 - Fase 21.2: configuracao declarativa externa para providers e bindings do Clark

Resumo:
- Removida a configuracao estrutural de MCPs e bindings do `.env`, migrando isso para `clark.config.json`.
- Introduzido loader validado com `zod` para providers e capabilities declaradas fora do codigo.
- Adicionados `clark.config.json` e `clark.config.example.json` com o provider `youbora` como primeiro caso configurado externamente.

Arquivos-chave:
- `apps/clark/src/config/file-config.ts`
- `apps/clark/src/config/settings.ts`
- `apps/clark/clark.config.json`
- `apps/clark/clark.config.example.json`
- `apps/clark/README.md`
- `docs/architecture/phases/phase-21.md`

Checklist de validacao:
- [x] `npm --prefix apps/clark run check`
- [x] `npm --prefix apps/clark run test`
- [x] `npm --prefix apps/clark run build`

Pendencias:
- O binding real do Youbora ainda depende de confirmar o nome exato da tool MCP a ser mapeada.
- Ainda nao ha schemas estritos de input/output por capability declarada no arquivo.

Proximo passo recomendado:
- Definir o primeiro binding real `youbora.session.fetch` com o nome exato da tool MCP e contratos tipados de entrada/saida.

### 2026-03-28 - Fase 21.3: comando doctor para validar ambiente do Clark

Resumo:
- Adicionado comando `clark doctor` para validar carga de config, conectividade WebSocket e reachability de providers MCP HTTP.
- O doctor tambem verifica se as tools configuradas nos bindings realmente existem nos providers e mostra as capabilities finais montadas.
- Expostos scripts de conveniencia para executar o doctor via `apps/clark` e pela raiz do repo.

Arquivos-chave:
- `apps/clark/src/core/doctor.ts`
- `apps/clark/src/cli/commands/doctor.ts`
- `apps/clark/src/cli/index.ts`
- `apps/clark/src/tests/doctor.test.ts`
- `apps/clark/README.md`
- `apps/clark/package.json`
- `package.json`

Checklist de validacao:
- [x] `npm --prefix apps/clark run check`
- [x] `npm --prefix apps/clark run test`
- [x] `npm --prefix apps/clark run build`

Pendencias:
- O doctor hoje retorna JSON; ainda nao ha modo humano mais amigavel para troubleshooting rapido no terminal.
- Ainda nao existe teste de `doctor` cobrindo cenarios de falha do servidor remoto ou binding MCP ausente.

Proximo passo recomendado:
- Implementar o primeiro binding real `youbora.session.fetch` com o nome exato da tool MCP e expandir o `doctor` com saida mais legivel para humanos.

### 2026-03-28 - Fase 21.4: handshake WebSocket minimo do Clark no Kael

Resumo:
- Adicionado endpoint `WS /ws` no Kael para aceitar o handshake inicial do Clark.
- Implementado runtime minimo em memoria para registrar clients conectados e marcar heartbeats.
- O Kael agora recebe `client.register`, responde `server.registered` e observa `client.heartbeat`, preparando o caminho para o futuro `task_request`.

Arquivos-chave:
- `src/api/server.ts`
- `src/api/server.test.ts`
- `src/edge/runtime.ts`
- `src/edge/protocol.ts`
- `docs/api.md`
- `docs/architecture/phases/phase-21.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/api/server.test.ts`

Pendencias:
- O Kael ainda nao envia `task_request` nem processa `client.task.result`.
- O registry de edge clients ainda e apenas em memoria e orientado a observabilidade/handshake.

Proximo passo recomendado:
- Implementar o primeiro dispatch manual de task (`system.info`) do Kael para o Clark antes de integrar esse fluxo ao chat/orquestrador.

### 2026-03-28 - Fase 21.5: suporte a providers MCP HTTP via bridge `mcporter` no Clark

Resumo:
- Adicionado um segundo adapter de provider MCP no Clark para casos em que o endpoint remoto exige transporte baseado em SSE/stream e nao funciona como JSON-RPC HTTP simples.
- O provider `mcp-http-bridge` usa `mcporter` localmente para `list/call`, mantendo o modelo declarativo por `clark.config.json`.
- O Youbora passou a ser documentado como primeiro caso desse tipo, evitando hardcode de URL e de tool no codigo.

Arquivos-chave:
- `apps/clark/src/mcp/bridge-http-client.ts`
- `apps/clark/src/mcp/capability-provider.ts`
- `apps/clark/src/config/file-config.ts`
- `apps/clark/src/config/settings.ts`
- `apps/clark/clark.config.example.json`
- `apps/clark/README.md`

Checklist de validacao:
- [x] `npm --prefix apps/clark run check`
- [x] `npm --prefix apps/clark run test`
- [x] `npm --prefix apps/clark run build`

Pendencias:
- Ainda falta confirmar o nome exato da tool MCP do Youbora para ativar o binding real `youbora.session.fetch`.
- O `doctor` ainda devolve JSON tecnico; a UX humana para troubleshooting continua simples.

Proximo passo recomendado:
- Confirmar a tool do MCP do Youbora e ativar o binding real `youbora.session.fetch` no `clark.config.json`.

### 2026-03-28 - Fase 21.6: capability HTTP generica por profile local no Clark

Resumo:
- Adicionada capability `internal.http.profile_request` para permitir requests HTTP genericos sem expor tokens ou headers sensiveis no payload da task.
- `clark.config.json` agora aceita `httpProfiles` com `baseUrl`, metodos permitidos e `defaultHeaders`, incluindo placeholders `${env:...}` resolvidos no startup.
- O caso do Traceview passou a ser modelado como profile local, deixando o Kael ciente apenas de `profile + path + query`.

Arquivos-chave:
- `apps/clark/src/capabilities/internal-http-profile-request.ts`
- `apps/clark/src/config/file-config.ts`
- `apps/clark/src/config/settings.ts`
- `apps/clark/clark.config.example.json`
- `apps/clark/README.md`
- `apps/clark/src/tests/internal-http-profile-request.test.ts`

Checklist de validacao:
- [x] `npm --prefix apps/clark run check`
- [x] `npm --prefix apps/clark run test`
- [x] `npm --prefix apps/clark run build`

Pendencias:
- O Kael ainda nao envia `task_request`; a capability ja existe no Clark, mas o dispatch remoto ainda nao foi implementado.
- Ainda nao ha response shaping semantico para Traceview; o retorno atual continua sendo HTTP bruto controlado.

Proximo passo recomendado:
- Implementar o primeiro dispatch manual de `task_request` do Kael para o Clark usando `internal.http.profile_request` com profile `traceview`.

### 2026-03-28 - Fase 21.7: hardening do bridge MCP HTTP/SSE no Clark

Resumo:
- Corrigido o adapter `mcp-http-bridge` para interpretar o envelope JSON real do `mcporter list`, em vez de assumir array cru, preservando mensagens uteis quando o provider SSE estiver offline.
- Ajustado o parsing de retorno do `mcporter call` para aceitar JSON ou texto simples sem quebrar a capability.
- Alinhado o `clark.config.json` e o exemplo do Clark com os nomes reais das tools expostas pelo MCP do Youbora (`get_metrics`, `get_rawdata`, `get_events`, `get_filter_help`, `get_metrics_help`).
- Adicionado fallback no bootstrap do Clark para registrar bindings MCP explicitamente configurados mesmo quando o discovery via `tools/list` falha.
- Endurecido o parser do bridge para extrair o JSON mesmo quando o `mcporter` imprime warnings ao redor do payload, e ampliado o buffer default para respostas grandes de `tools/list`.
- Adicionado fallback heuristico para recuperar nomes de tools a partir de output JSON malformado do `mcporter list`, evitando falha total do `doctor`/bootstrap quando o payload vem truncado ou corrompido.
- Alterada a captura do subprocesso `mcporter` no bridge do Clark para usar arquivos temporarios em vez de pipes, mitigando truncamento de stdout observado em `list --json` quando o CLI escreve muito volume para processos Node.

Arquivos-chave:
- `apps/clark/src/mcp/bridge-http-client.ts`
- `apps/clark/src/mcp/capability-provider.ts`
- `apps/clark/src/mcp/types.ts`
- `apps/clark/clark.config.json`
- `apps/clark/clark.config.example.json`
- `apps/clark/README.md`

Checklist de validacao:
- [x] `npm --prefix apps/clark run check`
- [ ] `npm --prefix apps/clark run test` (falhou por dependencia opcional ausente do `rolldown` no ambiente local)
- [ ] `npm --prefix apps/clark run doctor` (bloqueado no sandbox pelo `tsx` abrindo pipe IPC)

Pendencias:
- Confirmar em ambiente com rede o `doctor` contra o endpoint real do Youbora para validar discovery e bindings fim a fim.
- Resolver a dependencia opcional ausente do `rolldown` no ambiente local para voltar a executar a suite Vitest do Clark.

Proximo passo recomendado:
- Implementar o primeiro dispatch manual de `task_request` do Kael para o Clark usando `internal.http.profile_request` com profile `traceview`.

### 2026-03-28 - Fase 20.0: base de video intelligence com playback analysis e artifacts

Resumo:
- Introduzidos contratos canônicos de video intelligence para playback, generation e artifacts.
- Adicionados `PlaybackTriageService`, `VideoArtifactsService` e `ProviderBackedVideoGenerationService` ao dominio `video`.
- Wiring inicial no app/chat tooling para deixar a nova camada pronta para exposicao por tools e planner nos proximos incrementos.

Arquivos-chave:
- `src/capabilities/video/types.ts`
- `src/capabilities/video/playback-triage-service.ts`
- `src/capabilities/video/artifacts-service.ts`
- `src/capabilities/video/generation-service.ts`
- `src/app.ts`
- `docs/architecture/phases/phase-20.md`

Checklist de validacao:
- [ ] `npm run check`
- [ ] `npm test -- src/capabilities/video/playback-triage-service.test.ts src/capabilities/video/artifacts-service.test.ts src/capabilities/video/generation-service.test.ts`

Pendencias:
- Ainda nao ha tools PI dedicadas nem provider real de video generation.
- A geracao atual cobre imagem com persistencia; video permanece como contrato/stub.

Proximo passo recomendado:
- Expor `video_generate_image` no runtime PI e seguir com o proximo adapter de player (`shaka` ou `exoplayer`).

### 2026-03-12 - Refactor Fase 17: runtime compartilhado do planner entre API e chat

Resumo:
- Extraido modulo compartilhado `src/planner/runtime.ts` para montar os runtimes de `executeNext` e `reconcile`.
- Removida duplicacao de wiring entre `src/api/server.ts` e `src/chat/tooling-factory.ts`.
- Mantido o contrato desacoplado do planner: `PlannerService` continua recebendo runtime minimo injetado, sem depender de `KaelApp`.

Arquivos-chave:
- `src/planner/runtime.ts`
- `src/api/server.ts`
- `src/chat/tooling-factory.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/api/server.test.ts src/planner/service.test.ts`

Pendencias:
- Nenhuma funcional desta extracao; proximo passo segue sendo evolucao de actions/validacoes do planner.

Proximo passo recomendado:
- Continuar Fase 17 com `approve_execution` e validacoes de saida (`assert_*`).

### 2026-03-12 - Fase 14.x: guard contra loop de email para o proprio remetente

Resumo:
- `EmailIngestService` agora ignora emails cujo remetente e o proprio endereco configurado da conta Gmail do Kael.
- O guard atua antes do `chat.handleMessage` e antes do `sendReply`, evitando auto-reply para si mesmo e loops de polling.
- Telemetria de email ingest ganhou contador `selfSkipped`.

Arquivos-chave:
- `src/email/ingest-service.ts`
- `src/email/ingest-service.test.ts`
- `src/app.ts`
- `src/api/server.test.ts`
- `docs/architecture/phases/phase-14.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/email/ingest-service.test.ts src/api/server.test.ts`

Pendencias:
- O guard atual compara com o endereco configurado da conta; se houver aliases/plus-addressing relevantes, vale expandir a normalizacao.

Proximo passo recomendado:
- Normalizar aliases conhecidos da conta dedicada e adicionar regra opcional para ignorar `Auto-Submitted`/`Precedence` quando aparecerem.

### 2026-03-12 - Fase 19.1: registry MCP + approvals por servidor + telemetria

Resumo:
- Expandido `McpBridgeService` com registry persistente de servidores MCP (`config|http|stdio`) e approvals persistentes por servidor/transport.
- Adicionados endpoints operacionais para gerenciar registry e aprovar/negar uso de MCP.
- `/health` passou a expor `metrics.mcpRuntime`, e o stream de eventos passou a observar mudancas de registry/approvals MCP.

Arquivos-chave:
- `src/tools/mcp/mcp-bridge-service.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`
- `src/tools/mcp/mcp-bridge-service.test.ts`
- `docs/api.md`
- `docs/architecture/phases/phase-19.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/tools/mcp/mcp-bridge-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- Ainda falta CLI dedicada para gerenciar registry/approvals sem passar pela API.
- `mcp_call` segue exigindo alias registrado no formato `server.tool`.

Proximo passo recomendado:
- Fase 19.2: adicionar CLI operacional de MCP (`list-servers`, `register`, `approvals`) e ergonomia melhor de aliases/tool names.

### 2026-03-12 - Fase 19.0: MCP bridge via mcporter no runtime PI

Resumo:
- Implementado `McpBridgeService` para executar `mcporter list/call` com timeout, parsing JSON e bloqueio por policy de `http`/`stdio`.
- Integradas novas capabilities no engine/runtime: `mcpList`, `mcpCall`, `mcp_list` e `mcp_call`.
- Adicionada skill operacional `mcporter` em `.kael/skills` e documentada a nova fase de arquitetura.

Arquivos-chave:
- `src/tools/mcp/mcp-bridge-service.ts`
- `src/agents/tool-specs/mcp.ts`
- `src/agents/pi-tools.ts`
- `src/chat/tooling-factory.ts`
- `.kael/skills/mcporter/SKILL.md`
- `docs/architecture/phases/phase-19.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/tools/mcp/mcp-bridge-service.test.ts src/agents/pi-tools.test.ts src/agents/tool-specs/index.test.ts src/config.test.ts`
- [x] `npm test -- src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- Falta expor telemetria dedicada de MCP no `/health`.
- Ainda nao ha fluxo nativo para `mcporter auth/config`; o MVP cobre `list/call`.

Proximo passo recomendado:
- Fase 19.1: adicionar telemetria MCP no `/health` e surface segura para `auth/config`.

### 2026-03-10 - Fase 18.5: skill Youbora (NPAW) com script operacional e ENV dedicada

Resumo:
- Adicionada skill `youbora` em `.kael/skills` para consultas na API NPAW com assinatura MD5.
- Adicionado script local `query-youbora.mjs` para montar URL assinada, consultar API e retornar JSON estruturado.
- Variaveis `KAEL_YOUBORA_*` registradas no `.env` para evitar hardcode no `SKILL.md`.
- Guia de skills atualizado com secao dedicada de uso da skill Youbora.

Arquivos-chave:
- `.kael/skills/youbora/SKILL.md`
- `.kael/skills/youbora/scripts/query-youbora.mjs`
- `.env`
- `docs/skills.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `node --check .kael/skills/youbora/scripts/query-youbora.mjs`
- [x] `node .kael/skills/youbora/scripts/query-youbora.mjs` (validacao de uso sem args)
- [x] `node .kael/skills/youbora/scripts/query-youbora.mjs last24hours views` (erro de rede esperado no sandbox)

Pendencias:
- Validar consulta real em ambiente com acesso de rede externo.
- Opcional: adicionar parser de argumentos nomeados para melhorar UX (`--metrics`, `--type`, etc.).

Proximo passo recomendado:
- Executar teste end-to-end do `/youbora` com servidor Kael rodando e confirmar retorno real da API.

### 2026-03-09 - Fase 18.4: telemetria de qualidade de auto-selecao (motivos + sessao)

Resumo:
- Expandida telemetria de skills com qualidade de decisao (`autoDecisionCounts`, `lastAutoDecision`, `sessionAuto`).
- `ChatService` passou a enviar `sessionKey` para preparacao de turno de skills, habilitando agregacao por sessao.
- Ajustada heuristica/tuning para manter comportamento controlavel por options/ENV.
- Testes de skills ampliados com cenarios de motivos de decisao e sessao.

Arquivos-chave:
- `src/skills/service.ts`
- `src/skills/service.test.ts`
- `src/chat/service.ts`
- `src/api/server.test.ts`
- `docs/skills.md`
- `README.md`
- `docs/architecture/phases/phase-18.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/skills/service.test.ts src/api/server.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts`

Pendencias:
- Expor opcionalmente amostra de sessoes com baixa taxa de selecao para tuning operacional.
- Avaliar sinal adicional de "user override" (manual slash apos auto miss) para medir falso-negativo.

Proximo passo recomendado:
- Entregar incremento 18.5 com dashboard minimo de qualidade em `/health`/SSE e thresholds de alerta.

### 2026-03-09 - Fase 18.3: tuning configuravel de skills + heuristica refinada

Resumo:
- Adicionado tuning por ENV para skills (`KAEL_SKILLS_CATALOG_MAX_CHARS`, `KAEL_SKILLS_AUTO_MIN_SCORE`, `KAEL_SKILLS_AUTO_MAX_PER_TURN`).
- Heuristica de relevancia de auto-skill refinada para reduzir falso-positivo em mensagens genericas e reduzir falso-negativo por variacao lexical (prefix match).
- Prioridade de config ajustada para opcoes explicitas do `SkillService` prevalecerem sobre ENV.
- Testes de skills expandidos para cobrir threshold, budget e desativacao de auto por configuracao.

Arquivos-chave:
- `src/skills/service.ts`
- `src/skills/service.test.ts`
- `docs/skills.md`
- `README.md`
- `docs/architecture/phases/phase-18.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/skills/service.test.ts src/api/server.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts`

Pendencias:
- Tornar a heuristica semanticamente mais robusta (sinonimos/contexto), mantendo custo baixo.
- Avaliar telemetria adicional de qualidade de auto-selecao (hit/miss por sessao).

Proximo passo recomendado:
- Entregar incremento 18.4 com telemetria de qualidade e testes de regressao de auto-selecao por cenarios reais.

### 2026-03-09 - Fase 18.2: parser de frontmatter robusto + guia operacional de skills

Resumo:
- Parser de frontmatter de skills reforcado para suportar multiline (`|`/`>`) e listas simples.
- Cobertura de testes expandida para cenarios de aspas/colon e listas no frontmatter.
- Guia operacional de skills criado em `docs/skills.md` e referenciado no onboarding/README.

Arquivos-chave:
- `src/skills/service.ts`
- `src/skills/service.test.ts`
- `docs/skills.md`
- `README.md`
- `docs/core/START-HERE.md`
- `docs/architecture/phases/phase-18.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/skills/service.test.ts src/api/server.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts`

Pendencias:
- Melhorar heuristica de relevancia para reduzir falso-positivo em mensagens curtas/genericas.
- Tornar thresholds/budgets de skills configuraveis por env (catalogo e score minimo).

Proximo passo recomendado:
- Entregar incremento 18.3 com tuning configuravel e testes de qualidade de auto-selecao.

### 2026-03-09 - Fase 18.1: catalogo de skills + auto-invocacao conservadora

Resumo:
- `SkillService` evoluido para montar catalogo resumido de skills auto-invocaveis no turno.
- Implementada auto-invocacao conservadora de ate 1 skill por turno por heuristica de relevancia.
- Integracao no `ChatService` para preparar mensagem do turno com catalogo/skill selecionada antes do LLM.
- Incluidos testes unitarios para auto-invocacao e respeito a `disable-model-invocation`.

Arquivos-chave:
- `src/skills/service.ts`
- `src/skills/service.test.ts`
- `src/chat/service.ts`
- `docs/architecture/phases/phase-18.md`
- `docs/core/START-HERE.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/skills/service.test.ts src/api/server.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts`

Pendencias:
- Melhorar algoritmo de relevancia para reduzir falso-positivo em mensagens genericas.
- Adicionar ajuste configuravel de budget/threshold por env.
- Documentar guia operacional de autoria de skills em `.kael/skills`.

Proximo passo recomendado:
- Entregar incremento 18.2 com guia operacional + parser frontmatter mais robusto (YAML multiline/listas).

### 2026-03-09 - Fase 18.0: skills manuais em `.kael/skills` + telemetria inicial

Resumo:
- Implementado `SkillService` com discovery/parsing de `SKILL.md` em `.kael/skills`.
- Integrada invocacao manual de skill por slash no `ChatService` com substituicao de argumentos.
- Adicionada metrica `skillsRuntime` no `GET /health`.
- Incluidos testes unitarios de skill service e ajuste de testes de API health.

Arquivos-chave:
- `src/skills/service.ts`
- `src/skills/service.test.ts`
- `src/chat/service.ts`
- `src/app.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`
- `docs/architecture/phases/phase-18.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/skills/service.test.ts src/api/server.test.ts`
- [x] `npx vitest run src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts`

Pendencias:
- Implementar auto-invocacao por relevancia com limite de 1 skill por turno.
- Documentar guia operacional de autoria de skills em `.kael/skills`.
- Evoluir parser para suportar YAML multiline/estruturas mais ricas quando necessario.

Proximo passo recomendado:
- Entregar incremento 18.1 com catalogo de skills no contexto + auto-selecao conservadora.

### 2026-03-09 - Planejamento da Fase 18 (skills em `.kael/skills`)

Resumo:
- Definida arquitetura inicial da Fase 18 para suporte a skills no core.
- Diretório base inicial fixado em `.kael/skills`.
- Definido escopo MVP: discovery, parser, invocacao manual/automatica controlada e telemetria.

Arquivos-chave:
- `docs/architecture/phases/phase-18.md`
- `docs/architecture/README.md`
- `docs/core/START-HERE.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [ ] `npm run check`
- [x] revisao manual de consistencia entre arquitetura e roadmap

Pendencias:
- Especificar formato canônico do bloco de skill no prompt.
- Definir budget de catalogo de skills por turno.

Proximo passo recomendado:
- Implementar o MVP em incremento pequeno com leitura de `.kael/skills` e slash manual.

### 2026-03-07 - Teste dedicado do registro central de tool-specs

Resumo:
- Adicionado teste unitario dedicado para `createPiCapabilityTools`.
- O teste valida composicao por capability e nomes esperados das tools retornadas.

Arquivos-chave:
- `src/agents/tool-specs/index.test.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/agents/tool-specs/index.test.ts src/agents/pi-tools.test.ts`

Pendencias:
- Expandir cobertura com cenarios de erro/budget por capability direto nas factories (opcional).

Proximo passo recomendado:
- Definir se queremos testes unitarios por factory (`system/web/plans`) focados em branches de bloqueio.

### 2026-03-07 - Registro central de tool-specs no PI

Resumo:
- Criado registro central `src/agents/tool-specs/index.ts` com:
  - exports dos factories por capability;
  - `createPiCapabilityTools(...)` para composicao unificada.
- `pi-tools` passou a consumir o registro central, reduzindo wiring manual disperso.
- Ordem e contratos das tools preservados.

Arquivos-chave:
- `src/agents/tool-specs/index.ts`
- `src/agents/pi-tools.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/agents/pi-tools.test.ts src/agents/simple-engine.test.ts src/chat/turn-orchestrator.test.ts src/chat/command-router.test.ts`

Pendencias:
- Opcional: adicionar testes unitarios focados no registro `createPiCapabilityTools`.

Proximo passo recomendado:
- Criar `src/agents/tool-specs/index.test.ts` para validar composicao/ordem de retorno por capability.

### 2026-03-07 - Extracao de tool-specs `system` e `image` no PI

Resumo:
- `exec` e `process` foram extraidos de `pi-tools` para factory dedicada.
- `image_generate` foi extraido para factory dedicada.
- Novos modulos:
  - `src/agents/tool-specs/system.ts`;
  - `src/agents/tool-specs/image.ts`.
- `pi-tools` manteve budgets/loop guard/logging e passou a compor essas tools por registro.

Arquivos-chave:
- `src/agents/tool-specs/system.ts`
- `src/agents/tool-specs/image.ts`
- `src/agents/pi-tools.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/agents/pi-tools.test.ts src/agents/simple-engine.test.ts src/chat/turn-orchestrator.test.ts src/chat/command-router.test.ts`

Pendencias:
- Padronizar/exportar indice de `tool-specs` para reduzir wiring manual em `pi-tools`.

Proximo passo recomendado:
- Criar `src/agents/tool-specs/index.ts` e usar registro central para composicao das tools.

### 2026-03-07 - Extracao de tool-specs `plans` no PI

Resumo:
- Bloco completo `plan_*` foi extraido de `pi-tools` para factory dedicada.
- Novo modulo `src/agents/tool-specs/plans.ts` introduzido com:
  - `plan_create`, `plan_generate`, `plan_list`, `plan_get`,
  - `plan_update_step`, `plan_next`, `plan_execute_next`, `plan_reconcile`.
- `pi-tools` passou a compor tools de plano via registro, mantendo contratos e respostas.

Arquivos-chave:
- `src/agents/tool-specs/plans.ts`
- `src/agents/pi-tools.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/agents/pi-tools.test.ts src/agents/simple-engine.test.ts src/chat/turn-orchestrator.test.ts src/chat/command-router.test.ts`

Pendencias:
- Extrair `exec/process` e `image_generate` para concluir modularizacao do `pi-tools`.

Proximo passo recomendado:
- Migrar `exec` + `process` para `src/agents/tool-specs/system.ts`.

### 2026-03-07 - Extracao de tool-specs `workspace` no PI

Resumo:
- `workspace_search` e `workspace_read` foram extraidos de `pi-tools` para factory dedicada.
- Novo modulo `src/agents/tool-specs/workspace.ts` introduzido.
- `pi-tools` continua centralizando orquestracao e agora compoe tools de workspace via registro.

Arquivos-chave:
- `src/agents/tool-specs/workspace.ts`
- `src/agents/pi-tools.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/agents/pi-tools.test.ts src/agents/simple-engine.test.ts src/chat/turn-orchestrator.test.ts src/chat/command-router.test.ts`

Pendencias:
- Extrair `plan_*` e `exec/process` para reduzir o hardcode restante no `pi-tools`.

Proximo passo recomendado:
- Migrar bloco `plan_*` para `src/agents/tool-specs/plans.ts`.

### 2026-03-07 - Extracao de tool-specs `memory` no PI

Resumo:
- `memory_search`, `memory_get` e `memory_write` foram extraidos de `pi-tools` para factory dedicada.
- Novo modulo `src/agents/tool-specs/memory.ts` introduzido.
- `pi-tools` manteve logs/telemetria e passou a compor tools de memoria via registro.

Arquivos-chave:
- `src/agents/tool-specs/memory.ts`
- `src/agents/pi-tools.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/agents/pi-tools.test.ts src/agents/simple-engine.test.ts src/chat/turn-orchestrator.test.ts src/chat/command-router.test.ts`

Pendencias:
- Extrair blocos restantes (`workspace`, `plan_*`, `exec/process`) para reduzir hardcode residual no `pi-tools`.

Proximo passo recomendado:
- Migrar `workspace_search/read` para `src/agents/tool-specs/workspace.ts`.

### 2026-03-07 - Extracao de tool-specs `web` no PI

Resumo:
- `web_search`, `web_fetch` e `web_research` foram extraidos de `pi-tools` para factory dedicada.
- Novo modulo `src/agents/tool-specs/web.ts` introduzido com schema/execute e sumarizacao de resultado.
- `pi-tools` manteve controles centrais (budget, bloqueio, logs) e passou a compor tools web via registro.

Arquivos-chave:
- `src/agents/tool-specs/web.ts`
- `src/agents/pi-tools.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/agents/pi-tools.test.ts src/agents/simple-engine.test.ts src/chat/turn-orchestrator.test.ts src/chat/command-router.test.ts`

Pendencias:
- Extrair blocos restantes (`memory`, `workspace`, `plan_*`, `exec/process`) para reduzir hardcode residual.

Proximo passo recomendado:
- Migrar `memory_search/get/write` para `src/agents/tool-specs/memory.ts`.

### 2026-03-07 - Extracao de tool-specs `video` no PI

Resumo:
- `video_hls_inspect` e `video_probe` foram extraidos de `pi-tools` para factory dedicada.
- Novo modulo `src/agents/tool-specs/video.ts` introduzido.
- `pi-tools` manteve budgets/log/ordem de tools e passou a compor a tool de video via registro.

Arquivos-chave:
- `src/agents/tool-specs/video.ts`
- `src/agents/pi-tools.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/agents/pi-tools.test.ts src/agents/simple-engine.test.ts src/chat/turn-orchestrator.test.ts src/chat/command-router.test.ts`

Pendencias:
- Continuar migracao de tools restantes para `tool-specs/*` para reduzir hardcode de `pi-tools`.

Proximo passo recomendado:
- Extrair bloco `web_search/web_fetch/web_research` para `src/agents/tool-specs/web.ts`.

### 2026-03-07 - Extracao de tool-specs (`jobs`/`browser`) no PI

Resumo:
- `pi-tools` passou a consumir factories dedicadas para tools de `jobs` e `browser`.
- Novos modulos:
  - `src/agents/tool-specs/jobs.ts`;
  - `src/agents/tool-specs/browser.ts`.
- Mantida a mesma superficie externa de tools, budgets e telemetria.
- Reduzida duplicidade local em `pi-tools` para schema/execute dessas capacidades.

Arquivos-chave:
- `src/agents/pi-tools.ts`
- `src/agents/tool-specs/jobs.ts`
- `src/agents/tool-specs/browser.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/agents/pi-tools.test.ts src/agents/simple-engine.test.ts src/chat/turn-orchestrator.test.ts src/chat/command-router.test.ts`

Pendencias:
- Expandir mesmo padrao de tool-spec para outras ferramentas ainda hardcoded no `pi-tools`.

Proximo passo recomendado:
- Extrair `video_hls_inspect`/`video_probe` para `tool-specs/video.ts` mantendo o mesmo contrato.

### 2026-03-07 - Deduplicacao inicial entre `pi-tools` e `tooling-factory` (browser/jobs)

Resumo:
- Extraidos modulos compartilhados para reduzir duplicidade de shape/formatacao:
  - `src/jobs/tooling.ts` (filtros, mapeamento e formatacao de jobs + tail de log);
  - `src/capabilities/browser/presentation.ts` (deteccao de acoes de interacao e formatacao de resposta).
- `createChatTooling` passou a reutilizar helper de jobs em vez de manter logica inline.
- `pi-tools` passou a reutilizar formatters/helpers compartilhados de browser e jobs.
- `simple-engine` passou a reutilizar formatter compartilhado de browser.
- Novos testes unitarios adicionados para os modulos extraidos.

Arquivos-chave:
- `src/jobs/tooling.ts`
- `src/jobs/tooling.test.ts`
- `src/capabilities/browser/presentation.ts`
- `src/capabilities/browser/presentation.test.ts`
- `src/chat/tooling-factory.ts`
- `src/agents/pi-tools.ts`
- `src/agents/simple-engine.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/jobs/tooling.test.ts src/capabilities/browser/presentation.test.ts src/capabilities/browser/capability.test.ts src/capabilities/browser/service.test.ts src/agents/pi-tools.test.ts src/agents/simple-engine.test.ts src/chat/turn-orchestrator.test.ts src/chat/command-router.test.ts`

Pendencias:
- Seguir extraindo specs por capability para reduzir duplicidade restante em definicao de schemas/tools no `pi-tools`.

Proximo passo recomendado:
- Criar `tool-spec` dedicado para browser/jobs (schema + execute) e fazer `pi-tools` consumir via registro.

### 2026-03-07 - Fase 16.x: BrowserCapability com actions tipadas

Resumo:
- Introduzida `BrowserCapability` com `BROWSER_ACTIONS`/`BROWSER_ACTION_VALUES` para padronizar o mesmo estilo de extensao por capability usado no video.
- `createKaelApp` agora instancia `BrowserToolService` (runtime) e encapsula em `BrowserCapability`.
- `createChatTooling` passou a depender da capability (e nao do runtime direto), mantendo contrato externo `browserCommand`.
- `pi-tools` e `simple-engine` passaram a usar constants de actions de browser para reduzir string solta e manter consistencia.

Arquivos-chave:
- `src/capabilities/browser/capability.ts`
- `src/capabilities/browser/index.ts`
- `src/capabilities/browser/capability.test.ts`
- `src/app.ts`
- `src/chat/tooling-factory.ts`
- `src/agents/pi-tools.ts`
- `src/agents/simple-engine.ts`
- `docs/architecture/phases/phase-16.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/capabilities/browser/capability.test.ts src/capabilities/browser/service.test.ts src/agents/pi-tools.test.ts src/agents/simple-engine.test.ts src/chat/turn-orchestrator.test.ts src/chat/command-router.test.ts`

Pendencias:
- Aplicar padrao análogo para `system` separando capability de alto nivel e runtime interno.

Proximo passo recomendado:
- Definir contrato `SystemCapability` antes da migracao de `src/tools/system`.

### 2026-03-07 - Fase 16.x: migracao do browser runtime para `capabilities`

Resumo:
- Browser runtime migrado de `src/tools/browser` para `src/capabilities/browser`.
- Imports do core (app/chat/engine) atualizados para o novo namespace.
- Barrel `src/capabilities/browser/index.ts` adicionado para padronizar consumo por capability.
- Docs de arquitetura ativa atualizadas para refletir o novo caminho.

Arquivos-chave:
- `src/capabilities/browser/service.ts`
- `src/capabilities/browser/service.test.ts`
- `src/capabilities/browser/service.smoke.test.ts`
- `src/capabilities/browser/index.ts`
- `src/app.ts`
- `src/chat/service.ts`
- `src/chat/tooling-factory.ts`
- `src/agents/types.ts`
- `docs/architecture/phases/phase-16.md`
- `docs/architecture/diagrams/detailed-components.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/capabilities/browser/service.test.ts src/agents/simple-engine.test.ts`

Pendencias:
- Avaliar migracao de `system` separando capability (`exec/process`) de runtime interno de processos.

Proximo passo recomendado:
- Definir desenho alvo de `src/capabilities/system` + `src/runtime/system` antes de mover arquivos.

### 2026-03-07 - Fase 17.0: controle inicial de execucao em planos (`wait_execution` + `cancel_execution`)

Resumo:
- Planner ganhou novas actions `wait_execution` e `cancel_execution`.
- Runtime de `executeNext` foi ampliado para observar/cancelar runtime externo (`getJob`, `pollExec`, `cancelJob`, `cancelExec`).
- `nextAction` passou a priorizar step de controle pendente quando houver step anterior em `in_progress`.
- API/tooling/PI schema atualizados para aceitar `inputs.targetStepIndex`.
- Testes do planner adicionados para fluxo de wait/cancel.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/chat/tooling-factory.ts`
- `src/api/server.ts`
- `src/agents/types.ts`
- `src/agents/pi-tools.ts`
- `docs/architecture/phases/phase-17.md`
- `docs/planning/PROJECT-STATUS.md`
- `docs/core/START-HERE.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/planner/service.test.ts`

Pendencias:
- Implementar `approve_execution` para fechar trilha completa de controle.
- Evoluir actions de validacao (`assert_*`) e branching (`on_fail`, `maxRetries`).

Proximo passo recomendado:
- Implementar `approve_execution` com integracao a approvals de shell e reconcile imediato do step alvo.

### 2026-03-07 - Planejamento da Fase 17 (orquestracao de planos v2)

Resumo:
- Fase 17 adicionada ao roadmap para evoluir a execucao de planos com controle de lifecycle.
- Escopo inicial da fase definido com validacoes de saida e branching leve por step.
- Documento arquitetural dedicado da fase criado.

Arquivos-chave:
- `docs/planning/PROJECT-STATUS.md`
- `docs/architecture/phases/phase-17.md`
- `docs/core/START-HERE.md`

Checklist de validacao:
- [x] alinhamento de escopo com foco atual (CLI + API + engine + jobs de video)
- [x] consistencia de status entre `START-HERE` e `PROJECT-STATUS`

Pendencias:
- Transformar os itens da fase em tarefas implementaveis (ordem sugerida: controle -> validacao -> branching).

Proximo passo recomendado:
- Implementar primeiro `wait_execution` e `cancel_execution` para fechar o loop operacional minimo dos planos.

### 2026-03-06 - CI: job opcional browser-smoke no GitHub Actions

Resumo:
- Pipeline de CI criada em `.github/workflows/ci.yml` com jobs `check` e `test`.
- Job opcional `browser-smoke` adicionado com gate por variavel de repositorio (`KAEL_CI_BROWSER_SMOKE=true`) ou disparo manual do workflow.
- Job de smoke instala Chromium via Playwright e executa `npm run test:smoke:browser`.
- Documentacao de browser/arquitetura atualizada para refletir o gate operacional no CI.

Arquivos-chave:
- `.github/workflows/ci.yml`
- `docs/browser-control.md`
- `docs/architecture/phases/phase-16.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [ ] execucao do workflow no GitHub Actions (pendente de push no repositorio remoto)

Pendencias:
- Ativar `KAEL_CI_BROWSER_SMOKE=true` no ambiente CI que tenha permissao para launch do Chromium.

Proximo passo recomendado:
- Validar primeira execucao do workflow remoto e promover `browser-smoke` para gate obrigatorio onde o runner suportar Playwright.

### 2026-03-04 - Fase 16.4: smoke e2e de browser real (Playwright)

Resumo:
- Adicionado smoke e2e de browser runtime com Playwright real:
  - fluxo `open -> type -> press -> wait_for -> snapshot_text -> screenshot -> close`.
- Smoke usa pagina embutida (`data:` URL), evitando dependencia de servidor externo.
- Script dedicado de execucao adicionado:
  - `npm run test:smoke:browser`.
- Runtime de browser passou a aceitar `data:` URL para permitir cenarios de teste deterministico.
- Documentacao operacional atualizada com secao de smoke.

Arquivos-chave:
- `src/tools/browser/service.smoke.test.ts`
- `src/tools/browser/service.ts`
- `src/tools/browser/service.test.ts`
- `package.json`
- `docs/browser-control.md`
- `docs/architecture/phases/phase-16.md`

Checklist de validacao:
- [x] `npm run test:smoke:browser`
- [x] `npm test -- src/tools/browser/service.test.ts src/agents/simple-engine.test.ts`
- [x] `npm run check`

Pendencias:
- Promover smoke para job dedicado de CI em runner que suporte launch de Chromium sem restricoes.

Proximo passo recomendado:
- Criar etapa opcional de CI (`browser-smoke`) com gate por env para validar fluxo real em ambiente apropriado.

### 2026-03-04 - Fase 16.3/16.4: hardening operacional + atalhos slash de browser

Resumo:
- Browser runtime endurecido com:
  - cleanup de sessao por TTL;
  - eviccao por limite de sessoes (`maxSessions`);
  - telemetria detalhada por acao (calls/failures/latencia media + ultimo erro).
- PI tools com budget dedicado para browser:
  - `maxBrowserCalls`;
  - `maxBrowserInteractionCalls`.
- Fast-path de comandos slash para browser no `SimpleCommandEngine`:
  - `/browser-start`, `/browser-open`, `/browser-snapshot`, `/browser-shot`, `/browser-click`,
  - `/browser-type`, `/browser-press`, `/browser-wait`, `/browser-close`.
- Guia operacional de browser control criado em `docs/browser-control.md`.

Arquivos-chave:
- `src/tools/browser/service.ts`
- `src/agents/pi-tools.ts`
- `src/agents/pi-engine-adapter.ts`
- `src/config.ts`
- `src/agents/simple-engine.ts`
- `src/agents/simple-engine.test.ts`
- `docs/architecture/phases/phase-16.md`
- `docs/browser-control.md`
- `README.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/agents/simple-engine.test.ts src/chat/command-router.test.ts src/tools/browser/service.test.ts`

Pendencias:
- Ainda faltam smoke tests e2e em browser real no pipeline automatizado.
- Parser dos atalhos slash ainda e simples para seletores/textos com espacos/aspas complexas.

Proximo passo recomendado:
- Implementar smoke e2e real de browser control (fluxo abrir -> interagir -> screenshot -> close) e executar em rotina de validacao.

### 2026-03-04 - Fase 16.0: foundations de browser runtime (contrato + wiring + health)

Resumo:
- Registrada arquitetura da Fase 16 em documento dedicado com plano incremental e roteiro de testes por fase.
- Introduzido dominio de browser runtime com `BrowserToolService` (MVP foundation) e telemetria base.
- Estendido contrato `EngineTooling` com:
  - `browserCommand(...)`;
  - `browserRuntimeTelemetry()`.
- Wiring completo no app/chat:
  - `createKaelApp()` instancia `BrowserToolService`;
  - `createChatTooling()` delega para runtime de browser;
  - `createChatOnlyTooling()` bloqueia browser por politica.
- `GET /health` passou a expor `metrics.browserRuntime`.
- Integrada tool `browser` no runtime PI com resposta controlada de readiness (`disabled|not_implemented`) na fase foundation.

Arquivos-chave:
- `docs/architecture/phases/phase-16.md`
- `src/tools/browser/service.ts`
- `src/agents/types.ts`
- `src/chat/tooling-factory.ts`
- `src/app.ts`
- `src/agents/pi-tools.ts`
- `src/api/server.ts`
- `src/config.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/tools/browser/service.test.ts src/api/server.test.ts src/agents/simple-engine.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts`

Pendencias:
- Acoes browser ainda nao implementadas (fase 16.1 em diante).

Proximo passo recomendado:
- Implementar Fase 16.1 (read-only): `start/open/navigate/snapshot_text/screenshot/close` com persistencia de artifacts em `.kael-data/browser/artifacts`.

### 2026-03-04 - Fase 16.1: browser read-only funcional (start/open/navigate/snapshot/screenshot/close)

Resumo:
- Runtime de browser evoluido para read-only real com Playwright.
- Implementadas acoes:
  - `start` (inicia sessao por `sessionKey`);
  - `open|navigate` (navegacao com validacao de URL http/https);
  - `snapshot_text` (coleta titulo + preview textual da pagina);
  - `screenshot` (salva PNG em `KAEL_BROWSER_ARTIFACT_DIR`);
  - `close` (encerra sessao e limpa recursos).
- Tool `browser` no PI passou a retornar metadados uteis no texto/detalhes (`targetId`, `url`, `title`, `screenshotPath`, `textPreview`).
- Adicionado limite de screenshots por sessao (`KAEL_BROWSER_MAX_SCREENSHOTS_PER_TURN`) como guardrail inicial.
- Dependencia `playwright@1.58.2` adicionada ao projeto.

Arquivos-chave:
- `src/tools/browser/service.ts`
- `src/tools/browser/service.test.ts`
- `src/agents/pi-tools.ts`
- `package.json`
- `docs/architecture/phases/phase-16.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/tools/browser/service.test.ts src/agents/pi-tools.test.ts src/api/server.test.ts src/chat/command-router.test.ts src/chat/turn-orchestrator.test.ts src/agents/simple-engine.test.ts src/config.test.ts`

Pendencias:
- Acoes de interacao (`click|type|press|wait_for`) ainda nao implementadas.
- Falta lifecycle avancado de sessoes (TTL/cleanup proativo) para fase de hardening.

Proximo passo recomendado:
- Implementar Fase 16.2 com interacao UI (`click|type|press|wait_for`) e testes de fluxo funcional de site.

### 2026-03-04 - Fase 16.2: interacao UI no browser runtime (click/type/press/wait_for)

Resumo:
- Runtime de browser evoluido com acoes de interacao:
  - `click` (por seletor),
  - `type` (preenchimento de campo),
  - `wait_for` (espera por elemento visivel),
  - `press` (tecla global ou com foco via seletor).
- Adicionada resolucao de seletor com estrategia simples:
  - `text=<texto>`;
  - `label=<texto>`;
  - `role=<role>|<name-opcional>`;
  - fallback para CSS puro.
- Mantido fluxo por `sessionKey` e retorno padronizado no mesmo contrato de browser.

Arquivos-chave:
- `src/tools/browser/service.ts`
- `src/tools/browser/service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/tools/browser/service.test.ts src/agents/pi-tools.test.ts`

Pendencias:
- Ainda falta robustez de fluxo e2e real para formularios complexos (validacao por smoke manual recomendado).
- Falta hardening de lifecycle (cleanup proativo de sessoes por TTL) e metrica por tipo de acao/erro.

Proximo passo recomendado:
- Implementar Fase 16.3 (hardening operacional): cleanup de sessoes, budget anti-loop dedicado por acao browser e telemetria detalhada de erro/latencia.

### 2026-03-04 - Fase 15: image_generate + artifacts de turno + envio de anexo no email reply

Resumo:
- Adicionada capacidade de output multimodal no core:
  - `EngineTurnOutput` agora suporta `artifacts[]` (MVP: imagem gerada).
- Implementada tool `image_generate` no runtime PI:
  - chama provider de geracao de imagem;
  - retorna resumo textual para o modelo;
  - publica artifact para o turno.
- `PiEngineAdapter` passou a coletar artifacts emitidos por tools e devolve-los no resultado do turno.
- Integrado `ImageGeneratorService`:
  - `OpenAiImageGeneratorService` (`/images/generations`, `response_format=b64_json`);
  - `NoopImageGeneratorService` para fallback seguro.
- `EmailIngestService` passou a encaminhar artifacts do turno para o sender SMTP.
- `GmailSmtpSender` evoluido para `multipart/mixed` com anexos em base64 (alem de corpo textual).
- `GmailPop3Provider` ja em modo `RETR` + parse MIME segue entregando anexos de entrada no mesmo contrato.

Arquivos-chave:
- `src/agents/types.ts`
- `src/agents/pi-tools.ts`
- `src/agents/pi-engine-adapter.ts`
- `src/media/image-generator.ts`
- `src/chat/tooling-factory.ts`
- `src/app.ts`
- `src/chat/service.ts`
- `src/email/types.ts`
- `src/email/ingest-service.ts`
- `src/email/gmail-smtp-sender.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/email/gmail-pop3-provider.test.ts src/email/ingest-service.test.ts src/api/server.test.ts src/media/service.test.ts src/agents/pi-engine-adapter.test.ts`

Pendencias:
- Discord/web ainda nao usam artifacts de saida; apenas email reply envia anexo por enquanto.

Proximo passo recomendado:
- Expor artifacts de resposta na API (`POST /chat`) para clientes externos consumirem output multimodal diretamente.

### 2026-03-04 - Fase 14/15: email com parse MIME real de anexos (RETR + attachments[])

Resumo:
- Provider Gmail POP3 deixou de usar `TOP` para leitura parcial e passou a usar `RETR` (mensagem completa).
- Implementado parse MIME multipart basico no provider para extrair:
  - corpo textual (`text/plain`/fallback html simplificado);
  - anexos `image/*` e `audio/*` em `attachments[]` com `base64` completo.
- `EmailIngestService` agora encaminha `message.attachments` ao `ChatService` (`source=email`), habilitando pipeline multimodal real em emails.
- Mantido hardening de corpo para evitar poluicao por blobs base64 residuais.
- Adicionados testes do parser MIME (`parseRetrResponse`) e de ingest.

Arquivos-chave:
- `src/email/gmail-pop3-provider.ts`
- `src/email/gmail-pop3-provider.test.ts`
- `src/email/types.ts`
- `src/email/ingest-service.ts`
- `src/email/ingest-service.test.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/email/gmail-pop3-provider.test.ts src/email/ingest-service.test.ts`

Pendencias:
- Parser MIME ainda e propositalmente basico; pode evoluir para casos mais exoticos (encodings raros/anexos inline complexos).

Proximo passo recomendado:
- Adicionar metrica de anexos extraidos por email e taxa de falha de parse no `/health`.

### 2026-03-04 - Fase 14/15: hardening do ingest de email contra base64 truncado

Resumo:
- `EmailIngestService` agora sanitiza blocos base64/MIME no corpo de email antes de enviar ao `ChatService`.
- Remocao de blobs base64 evita que o modelo tente interpretar anexos truncados recebidos via POP3 `TOP`.
- Mantem metadados textuais relevantes e adiciona marcador (`[[base64_omitted_lines:N]]`) quando blob e omitido.
- Adicionado teste unitario cobrindo sanitizacao de bloco `Content-Transfer-Encoding: base64`.

Arquivos-chave:
- `src/email/ingest-service.ts`
- `src/email/ingest-service.test.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/email/ingest-service.test.ts`

Pendencias:
- Ainda nao ha parse completo de anexos MIME de email para virar `attachments[]` multimodais reais.

Proximo passo recomendado:
- Implementar parse MIME (multipart) no provider para extrair anexos de imagem/audio como `attachments`.

### 2026-03-04 - Fase 15: interface de chat (CLI) com suporte a anexos

Resumo:
- Comando `chat` da CLI agora aceita anexos com flag repetivel `--attach <path>`.
- CLI converte arquivo local para `base64`, infere `mimeType` por extensao e envia no payload `attachments[]` para `POST /chat`.
- Validacao restringe a anexos `image/*` e `audio/*` na interface CLI.

Arquivos-chave:
- `src/cli/index.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`

Pendencias:
- Inferencia de MIME no CLI ainda e por extensao; pode evoluir para sniffing de bytes.

Proximo passo recomendado:
- Expor upload/anexo na interface web/chat visual (quando essa interface estiver ativa no runtime).

### 2026-03-04 - Fase 15: hardening de budget multimodal por origem (API/Discord/Email)

Resumo:
- `MediaUnderstandingService` passou a aplicar orcamento por mensagem e por origem:
  - limite de anexos por `source` (`api`, `discord`, `email`, `unknown`);
  - limite total de bytes multimodais por mensagem;
  - deadline de processamento multimodal por turno.
- `ChatService` agora propaga `source` para o preprocessamento multimodal (`api`, `discord`, `email`).
- `config` expandido com novos `KAEL_MEDIA_*` para controle fino de budget.
- Telemetria multimodal ganhou contadores de skip/controle de budget:
  - `processedAttachments`, `skippedTooLarge`, `skippedBySourceLimit`,
    `skippedByTotalBytesBudget`, `skippedByProcessingBudget`.
- Testes cobrindo limite por origem e ajustes de mocks/config em API e jobs e2e.

Arquivos-chave:
- `src/media/service.ts`
- `src/media/service.test.ts`
- `src/chat/service.ts`
- `src/config.ts`
- `src/app.ts`
- `src/api/server.ts`
- `src/integrations/discord/discord-bot.ts`
- `src/email/ingest-service.ts`
- `src/api/server.test.ts`
- `src/api/jobs.e2e.test.ts`
- `docs/architecture/phases/phase-15.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/media/service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- Ainda faltam fallback multi-provider de audio e parser vision mais robusto.

Proximo passo recomendado:
- Adicionar fallback de transcricao (provider secundario) no mesmo contrato de `MediaUnderstandingService`.

### 2026-03-04 - Fase 15: media-understanding inicial (OpenAI) + contexto no turno + metricas

Resumo:
- Criado `MediaUnderstandingService` com duas implementacoes:
  - `NoopMediaUnderstandingService` (fallback seguro);
  - `OpenAiMediaUnderstandingService` (descricao de imagem via `/chat/completions` + transcricao de audio via `/audio/transcriptions`).
- `ChatService` passou a executar preprocessamento multimodal antes do turno LLM e injetar bloco `[media_context]` na mensagem efetiva do modelo.
- Adicionada telemetria de runtime multimodal (`processedRequests`, `appliedRequests`, `imageDescribed`, `audioTranscribed`, `failures`) exposta em `GET /health`.
- `createKaelApp` integra automaticamente `noop` vs `openai` por config.
- `KaelConfig` expandido com bloco `media` e variaveis `KAEL_MEDIA_*`.
- Adicionados testes unitarios da camada multimodal e ajuste de mocks de API para novo contrato de config/telemetria.

Arquivos-chave:
- `src/media/service.ts`
- `src/media/service.test.ts`
- `src/chat/service.ts`
- `src/app.ts`
- `src/config.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`
- `src/api/jobs.e2e.test.ts`
- `docs/architecture/phases/phase-15.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/media/service.test.ts src/api/server.test.ts src/chat/turn-orchestrator.test.ts`

Pendencias:
- Falta hardening de budget/custo por anexo e fallback multi-provider de audio.

Proximo passo recomendado:
- Adicionar controle de budget multimodal por turno (max anexos processados e early-stop por timeout parcial), com telemetria por canal.

### 2026-03-03 - Fase 15: ingress multimodal base (contrato + API + Discord)

Resumo:
- Adicionado contrato canônico de anexos de entrada (`EngineInboundAttachment`) no `EngineTurnInput`.
- `ChatService` e `TurnOrchestrator` agora aceitam/encaminham anexos opcionalmente sem quebrar o fluxo textual existente.
- `POST /chat` foi estendido para receber `attachments[]` (image/audio + base64), com validacao de payload e idempotency signature incluindo anexos.
- Integracao Discord passou a baixar anexos de `image/*` e `audio/*` (com timeout/limite), convertendo para base64 e enviando ao chat.
- Transcript da sessao agora registra um resumo textual dos anexos recebidos (`[attachments]`) para continuidade de contexto.
- Registrada arquitetura da Fase 15 em documento dedicado.

Arquivos-chave:
- `src/agents/types.ts`
- `src/chat/service.ts`
- `src/chat/turn-orchestrator.ts`
- `src/api/server.ts`
- `src/integrations/discord/discord-bot.ts`
- `docs/architecture/phases/phase-15.md`
- `docs/core/START-HERE.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [ ] `npm run check`
- [ ] testes alvo de API/chat/discord

Pendencias:
- Ainda nao ha entendimento multimodal (descricao/transcricao); esta entrega cobre apenas ingress e transporte dos anexos.

Proximo passo recomendado:
- Implementar `MediaUnderstandingService` inicial (OpenAI: image describe + audio transcription) e injetar saida no prompt do turno.

### 2026-03-03 - Observabilidade: metricas de timeout/bloqueio por tool no /health

Resumo:
- Engine ganhou snapshot de telemetria de runtime (`timeouts`, `toolCallsByName`, `blockedCallsByTool`) via contrato opcional do `AgentEngine`.
- `PiEngineAdapter` passou a acumular contadores globais por tool e total de timeouts.
- `HybridEngine`/fallback propagam snapshot de telemetria do engine PI para manter visibilidade em `engineMode=hybrid`.
- `ChatService` e `TurnOrchestrator` expuseram o snapshot para API.
- Endpoint `GET /health` agora retorna `metrics.engineRuntime` com esses contadores.

Arquivos-chave:
- `src/agents/types.ts`
- `src/agents/pi-engine-adapter.ts`
- `src/agents/hybrid-engine.ts`
- `src/agents/simple-engine.ts`
- `src/agents/factory.ts`
- `src/chat/turn-orchestrator.ts`
- `src/chat/service.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm run test -- src/api/server.test.ts src/agents/pi-engine-adapter.test.ts`

Pendencias:
- Metricas ainda sao in-memory por processo; nao ha agregacao cross-processo.

Proximo passo recomendado:
- Expor metricas por janela temporal (ultimos 5/15 min) para diferenciar picos de acumulado historico.

### 2026-03-03 - Runtime hardening: fallback de timeout com evidencia parcial + retry Discord API

Resumo:
- `PiEngineAdapter` agora agrega resumo das tools web executadas no turno e, em timeout, inclui evidencias parciais no erro do turno.
- `ChatService` passou a extrair essas evidencias parciais e exibi-las na resposta de fallback de timeout (best-effort), em vez de retornar apenas erro generico.
- `pi-tools` ganhou summaries estruturados para `web_search`, `web_fetch` e `web_research`, usados na trilha de fallback.
- Cliente Discord (`discordApi`) agora aplica retry com backoff+jitter para `429`/`5xx` e falhas de rede transitórias, reduzindo falhas intermitentes de typing/envio.

Arquivos-chave:
- `src/agents/pi-engine-adapter.ts`
- `src/agents/pi-tools.ts`
- `src/chat/service.ts`
- `src/integrations/discord/discord-bot.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm run test -- src/agents/pi-engine-adapter.test.ts src/agents/tool-loop-guard.test.ts src/chat/turn-orchestrator.test.ts`

Pendencias:
- Fallback ainda depende das evidencias capturadas por tool summary; nao persiste pacote de evidencia por turno para reuso posterior.

Proximo passo recomendado:
- Persistir snapshot de evidencias web por `requestId` para fallback deterministico mesmo em falhas antes do `agent_end`.

### 2026-03-03 - Docs: README principal reestruturado (PT-BR first)

Resumo:
- README reescrito com foco de pagina principal do GitHub: proposta de valor clara, quick start rapido e secoes mais escaneaveis.
- Conteudo reorganizado por prioridade: visao do produto, stack, setup, capacidades, comandos-chave e docs de referencia.
- Adicionado destaque explicito do modo `discord-bot` sem scheduler/email polling para evitar duplicacao operacional.

Arquivos-chave:
- `README.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] Revisao manual de links/comandos e consistencia textual

Pendencias:
- Opcional: incluir GIF curto/screenshot da UI para aumentar impacto visual da pagina inicial.

Proximo passo recomendado:
- Adicionar secao \"Exemplos reais\" com 3 fluxos (video, pesquisa, email) para onboarding mais rapido.

### 2026-03-03 - Fase 14/Runtime: evitar polling de email duplicado entre API e Discord

Resumo:
- `createKaelApp` passou a aceitar opcoes de runtime (`startAutomation`, `enableEmailPolling`) para separar papeis entre processos.
- Comando `discord-bot` agora sobe em modo sem automacao/scheduler e sem `email_poll`, evitando ingest duplicado quando API e Discord rodam juntos.
- API/`server` mantem comportamento padrao (scheduler + heartbeat + planner + email_poll) sem mudanca funcional.

Arquivos-chave:
- `src/app.ts`
- `src/cli/index.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`

Pendencias:
- Coordenacao distribuida por lock de processo ainda nao existe (estrategia atual e separacao de papeis por comando).

Proximo passo recomendado:
- Opcional: adicionar lock de lider para scheduler quando houver multiplas instancias full-runtime.

### 2026-03-03 - Fase 9/11: disciplina de pesquisa web para evitar timeout por cadeia de searches

Resumo:
- Prompt do `PiEngineAdapter` ganhou regra explicita de disciplina web: preferir `web_research` para perguntas abertas e evitar cadeia de `web_search`.
- Quando uma tool web retorna bloqueio (budget/loop), o payload agora inclui `nextAction=finalize_answer_with_available_evidence` para induzir encerramento da resposta em best-effort.
- Mantida telemetria de completion nas tools web para diagnostico mais claro.
- Adicionado teste unitario para garantir injecao dessa disciplina de pesquisa no prompt.

Arquivos-chave:
- `src/agents/pi-engine-adapter.ts`
- `src/agents/pi-tools.ts`
- `src/agents/pi-engine-adapter.test.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm run test -- src/agents/pi-engine-adapter.test.ts src/agents/tool-loop-guard.test.ts`

Pendencias:
- Adicionar fallback de resposta automatica no `ChatService` para timeout com evidencias parciais de pesquisa.

Proximo passo recomendado:
- Persistir "ultimo pacote de evidencia web" por turno e usar fallback deterministico quando o LLM atingir timeout.

### 2026-03-03 - Fase 7: guardrail para loop web_fetch/web_search + telemetria de status

Resumo:
- Ajustado `ToolLoopGuard` para bloquear repeticao sem progresso em `web_fetch`/`web_search` com threshold dedicado (`webNoProgressThreshold`), reduzindo risco de timeout por loops web no mesmo turno.
- Mantido threshold separado para `process poll`, evitando regressao em monitoramento legitimo de processos.
- Telemetria das tools web ajustada para registrar `status=completed` (antes aparecia `status=unknown`), melhorando diagnostico operacional.
- Adicionado teste unitario cobrindo bloqueio cedo de `web_fetch` repetido sem progresso.

Arquivos-chave:
- `src/agents/tool-loop-guard.ts`
- `src/agents/tool-loop-guard.test.ts`
- `src/agents/pi-tools.ts`
- `docs/architecture/phases/phase-7.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm run test -- src/agents/tool-loop-guard.test.ts src/agents/pi-engine-adapter.test.ts`

Pendencias:
- Expor metricas agregadas de bloqueio por tipo (`exec/process/web`) no endpoint de observabilidade.

Proximo passo recomendado:
- Adicionar contador de `pi.turn.timeout` por rota/ferramenta dominante para tuning automatico de budgets.

### 2026-03-03 - Fase 8: recall de memoria mais consistente para fatos pessoais

Resumo:
- `PiEngineAdapter` ganhou detector de perguntas com alta chance de depender de memoria (ex: "qual meu time", "minha preferencia", "lembra do combinado").
- `buildPrompt` agora injeta instrucoes explicitas de recall nesses casos: `memory_search` primeiro, `memory_get` para confirmar, e proibicao de inventar quando nao houver evidencia.
- Descricoes das tools `memory_search` e `memory_get` foram reforcadas para priorizar fatos pessoais/historicos.
- Adicionados testes unitarios para garantir que o prompt ativa fluxo de memoria com e sem contexto.

Arquivos-chave:
- `src/agents/pi-engine-adapter.ts`
- `src/agents/pi-tools.ts`
- `src/agents/pi-engine-adapter.test.ts`
- `docs/architecture/phases/phase-8.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm run test -- src/agents/pi-engine-adapter.test.ts`

Pendencias:
- Cobrir mais gatilhos semanticos reais via telemetria de misses de recall em producao.

Proximo passo recomendado:
- Adicionar metrica/evento de "memory recall expected but not called" para tuning continuo do prompt.

### 2026-03-03 - Fase 14: anti-duplicacao de poll + auto-reply SMTP

Resumo:
- `EmailIngestService` recebeu lock de execucao (`pollInFlight`) para impedir overlap entre polls e reduzir ingest duplicado.
- Adicionado `EmailSender` e implementado `GmailSmtpSender` (SMTP TLS/Auth Login) para resposta automatica por email.
- Runtime atualizado para habilitar sender por config (`KAEL_EMAIL_AUTO_REPLY_ENABLED`) sem acoplamento ao provider.
- Config de email expandida com parametros SMTP (`KAEL_EMAIL_GMAIL_SMTP_*`).

Arquivos-chave:
- `src/email/ingest-service.ts`
- `src/email/types.ts`
- `src/email/gmail-smtp-sender.ts`
- `src/app.ts`
- `src/config.ts`
- `src/email/ingest-service.test.ts`
- `docs/architecture/phases/phase-14.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/email/ingest-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- Provider push (Gmail Pub/Sub) mantendo contrato `EmailProvider`.

Proximo passo recomendado:
- Implementar `gmail_pubsub` provider e manter `gmail_pop3` como fallback.

### 2026-03-03 - Fase 14: email ingress MVP (provider + scheduler)

Resumo:
- Implementado domínio de email com contrato `EmailProvider` e `EmailIngestService`.
- Adicionado provider inicial `GmailPop3Provider` (polling POP3 sobre TLS, parsing de headers/body e dedupe por UID persistido).
- Integrado ao runtime via scheduler (`email_poll`) para ingest periódico no `ChatService`.
- Configuração adicionada em `KAEL_EMAIL_*` para habilitar/desabilitar e parametrizar a conta Gmail dedicada.

Arquivos-chave:
- `src/email/types.ts`
- `src/email/pop3-client.ts`
- `src/email/gmail-pop3-provider.ts`
- `src/email/ingest-service.ts`
- `src/app.ts`
- `src/config.ts`
- `docs/architecture/phases/phase-14.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/email/ingest-service.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- Provider push (Gmail Pub/Sub) para reduzir latencia e custo de polling.

Proximo passo recomendado:
- Criar `gmail_pubsub` provider no mesmo contrato de `EmailProvider` e promover POP3 para fallback.

### 2026-03-03 - Fase 12: testes de corrida do supervisor (timeout/kill + remove/output)

Resumo:
- Adicionada suite dedicada para `ShellProcessSupervisor` com runner fake deterministico.
- Coberto cenario de corrida `kill` proximo do `timeout`, garantindo estado final `timed_out` quando o close chega tarde.
- Coberto cenario de `remove` durante output continuo, garantindo que a sessao removida nao reaparece.
- Fase 12 marcada como concluida com checklist completo.

Arquivos-chave:
- `src/tools/system/shell-process-supervisor.test.ts`
- `docs/architecture/phases/phase-12.md`
- `docs/core/START-HERE.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/tools/system/shell-process-supervisor.test.ts src/tools/system/shell-tool-service.test.ts`

Pendencias:
- Evoluir snapshots/versionamento do supervisor como melhoria pos-fase.

Proximo passo recomendado:
- Iniciar Fase 13 com foco em cobertura automatizada de runtime de video (`video-inspect-tool-service`).

### 2026-03-03 - Fase 12: supervisor dedicado para lifecycle de exec/process

Resumo:
- Criado `ShellProcessSupervisor` para centralizar ciclo de vida de execucao shell (`start`, `poll/list`, `kill`, `log`, `remove`).
- `ShellToolService` refatorado para delegar runtime de processo ao supervisor e manter policy/preflight/approvals no service.
- Corrigida condicao de corrida em `process remove`: sessao removida nao volta a aparecer apos encerramento tardio do processo.
- Adicionado teste cobrindo o cenario de nao-ressurreicao de sessao apos `remove`.

Arquivos-chave:
- `src/tools/system/shell-process-supervisor.ts`
- `src/tools/system/shell-tool-service.ts`
- `src/tools/system/shell-tool-service.test.ts`
- `docs/architecture/phases/phase-12.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/tools/system/shell-tool-service.test.ts`
- [x] `npx vitest run src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- Nenhuma pendencia aberta da fase apos adicao da suite de corrida dedicada.

Proximo passo recomendado:
- Iniciar Fase 13 com cobertura automatizada de runtime de video.

### 2026-03-03 - Refactor pre-Fase 12: tooling factory + contrato ShellRuntime

Resumo:
- Extraida a montagem de `EngineTooling` do `ChatService` para `src/chat/tooling-factory.ts` (`createChatTooling` + `createChatOnlyTooling`).
- `ChatService` simplificado para focar fluxo de roteamento/turno, recebendo `tooling` pronto por injecao.
- Introduzido contrato `ShellRuntime` em `shell-tool-service`, com consumidores (`app`/`chat`) dependentes da interface em vez da classe concreta.

Arquivos-chave:
- `src/chat/tooling-factory.ts`
- `src/chat/service.ts`
- `src/app.ts`
- `src/tools/system/shell-tool-service.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/api/server.test.ts src/chat/command-router.test.ts src/chat/routing-telemetry.test.ts src/agents/simple-engine.test.ts`
- [x] `npx vitest run src/tools/system/shell-tool-service.test.ts`

Pendencias:
- Nenhuma pendencia deste refactor.

Proximo passo recomendado:
- Iniciar Fase 12 implementando supervisor dedicado de `exec/process` por tras do contrato `ShellRuntime`.

### 2026-03-03 - Fase 11: telemetria de roteamento (fast-path vs LLM)

Resumo:
- Adicionada telemetria de roteamento no `ChatService` para contabilizar turnos `compact`, `fast_path` e `llm_turn`.
- Incluido log estruturado `chat.route.selected` com `sessionKey` e `requestId` para cada rota escolhida.
- Exposta metrica `chatRouting` no endpoint `/health`, permitindo observabilidade em runtime e diff no stream de eventos via assinatura de health.

Arquivos-chave:
- `src/chat/routing-telemetry.ts`
- `src/chat/service.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/chat/routing-telemetry.test.ts src/api/server.test.ts`

Pendencias:
- Nenhuma pendencia aberta da Fase 11.

Proximo passo recomendado:
- Iniciar Fase 12 com supervisor dedicado de `exec/process` (lifecycle, timeout e cancelamento deterministico).

### 2026-03-03 - Fase 11: extracao do command router com testes unitarios

Resumo:
- Extraido o fast-path de slash commands do `ChatService` para um modulo dedicado (`CommandRouter`).
- Mantido comportamento externo: somente slash commands entram no fast-path e apenas quando atalhos operacionais estao habilitados.
- Adicionados testes unitarios diretos cobrindo roteamento habilitado/desabilitado e mensagem sem slash.

Arquivos-chave:
- `src/chat/command-router.ts`
- `src/chat/command-router.test.ts`
- `src/chat/service.ts`
- `docs/architecture/phases/phase-11.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/chat/command-router.test.ts src/agents/simple-engine.test.ts`

Pendencias:
- Expor telemetria de fast-path vs turno LLM em eventos/logs.

Proximo passo recomendado:
- Iniciar implementacao da telemetria do roteador no `ChatService`/orquestrador para fechar a Fase 11.

### 2026-02-27 - Video jobs: manter cancelamento em erro de processo

Resumo:
- Ajustado `VideoJobService` para preservar status `canceled` quando um job previamente cancelado dispara `process.on("error")`.
- Mantido cleanup de `canceledJobs` no handler de erro para evitar estado residual quando `close` nao chega.
- Adicionado teste cobrindo cancelamento seguido de erro de processo e validando drenagem da fila.

Arquivos-chave:
- `src/tools/video/video-job-service.ts`
- `src/tools/video/video-job-service.test.ts`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/tools/video/video-job-service.test.ts`

Pendencias:
- Revisar classificacao de logs para separar claramente erro operacional vs erro esperado apos cancelamento.

Proximo passo recomendado:
- Avaliar se eventos de cancelamento com erro devem gerar log `info`/`warn` em vez de `error`.

### 2026-02-27 - Fase 11: fast-path de slash commands no ChatService

Resumo:
- `ChatService` agora faz fast-path de slash commands no nivel do chat, com execucao deterministica via `SimpleCommandEngine`.
- O fast-path passa a valer tambem quando o engine principal esta em modo `pi`, reduzindo dependencia do LLM para comandos operacionais.
- Fluxos especiais existentes foram preservados (`/compact` no `MemoryOrchestrator` e fallback de `playVLC` no caminho conversacional).
- Planejamento das proximas fases registrado (Fases 11-13) com foco em orquestracao de reply, supervisor de shell e qualidade de video runtime.

Arquivos-chave:
- `src/chat/service.ts`
- `docs/architecture/README.md`
- `docs/architecture/phases/phase-11.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/agents/simple-engine.test.ts src/agents/pi-engine-adapter.test.ts`

Pendencias:
- Extrair roteador de comandos para modulo dedicado e cobrir com testes unitarios diretos.

Proximo passo recomendado:
- Implementar extracao do command router (Fase 11, item 2) sem alterar comportamento externo.

### 2026-02-25 - Fase 10: deduplicacao semantica basica em memoria de longo prazo

Resumo:
- `MemoryService.write(target=long_term)` agora bloqueia entradas semanticamente similares via similaridade de tokens (jaccard/containment), alem do dedupe textual literal.
- Dedupe semantica avalia por bloco de entrada em `MEMORY.md` (secoes `## <timestamp>`), reduzindo repeticao de fatos reescritos.
- Adicionado teste de regressao para evitar append de memoria longa com texto equivalente em outra redacao.
- Ajustado `PROJECT-STATUS`/Fase 10 para refletir conclusao da pendencia de deduplicacao semantica.

Arquivos-chave:
- `src/memory/service.ts`
- `src/memory/service.test.ts`
- `docs/architecture/phases/phase-10.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [ ] `npm run check`
- [x] `npx vitest run src/memory/service.test.ts`

Pendencias:
- Calibrar thresholds de similaridade com uso real para reduzir falsos positivos/negativos.

Proximo passo recomendado:
- Fase 9.x: suporte opcional a multiplos providers de pesquisa com fallback plugavel.

### 2026-02-21 - Shell runtime hardening (exec/process)

Resumo:
- `ShellToolService` reforcado com `failureCode` padronizado por sessao (`syntax_error`, `allowlist_miss`, `timeout_overall`, `timeout_no_output`, etc).
- Adicionado timeout por ausencia de output (`KAEL_EXEC_NO_OUTPUT_TIMEOUT_MS`) para evitar comandos presos sem progresso.
- `process` expandido com novas acoes: `log` (paginacao por offset/limit) e `remove` (limpeza/cancelamento da sessao).
- `process list` agora ordena por recencia e retorna janela maior (50 sessoes).
- `exec` fallback shell ajustado para `sh -c` (evita combinacoes menos portaveis com `-l`).

Arquivos-chave:
- `src/tools/system/shell-tool-service.ts`
- `src/config.ts`
- `src/agents/pi-tools.ts`
- `src/agents/types.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/tools/system/shell-tool-service.test.ts src/agents/tool-loop-guard.test.ts src/api/server.test.ts`

Pendencias:
- Unificar lifecycle em supervisor dedicado (estilo OpenClaw) para `exec/process`.
- Evoluir parser/policy de shell para reduzir approvals desnecessarios em comandos compostos.

Proximo passo recomendado:
- Implementar supervisor de processos com timeout total + no-output + cancelamento deterministico por escopo.

### 2026-02-21 - Execucao real para pedidos operacionais (VLC)

Resumo:
- Prompt base atualizado para priorizar execucao real via tools (`exec/process`) em pedidos operacionais, evitando resposta apenas textual.
- Prompt de turno PI ganhou instrucao operacional extra quando detectar pedido de execucao.
- Fallback no `ChatService`: quando o modelo responder apenas `/playVLC "url"`, Kael converte para `exec` (`vlc '<url>'`) automaticamente.

Arquivos-chave:
- `src/config.ts`
- `src/agents/pi-engine-adapter.ts`
- `src/chat/service.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/api/server.test.ts src/agents/pi-engine-adapter.test.ts`

Pendencias:
- Generalizar fallback para outros slash/acoes (nao so `/playVLC`).
- Preferir sempre tool-call no proprio turno do modelo (reduzir dependencia de fallback textual).

### 2026-02-21 - Observabilidade PI: diagnostico de resposta vazia (OpenClaw-inspired)

Resumo:
- Propagado `requestId` de `/chat` ate o engine para correlacao fim-a-fim em logs.
- Adicionada telemetria de turno PI por tentativa (`started/completed/timeout/prompt_failed/agent_end_error/empty_content`).
- Em caso de `Pi SDK returned empty content`, agora gravamos dump estruturado com shape de mensagens/eventos.
- Configurado dump local em `dataDir/debug/pi-failures/<turnId>.json` para analise forense sem depender de stacktrace opaco.

Arquivos-chave:
- `src/api/server.ts`
- `src/chat/service.ts`
- `src/chat/turn-orchestrator.ts`
- `src/agents/types.ts`
- `src/agents/pi-engine-adapter.ts`
- `src/agents/factory.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Expor `lastPiFailure` no `/health` (resumo do ultimo dump) para triagem mais rapida em operacao.

Proximo passo recomendado:
- Capturar e logar status/body sanitizado de erro do provider dentro do adapter para separar falha de modelo, quota e parsing.

### 2026-02-21 - Fase 9.2: web_fetch + extracao + cache TTL

Resumo:
- Integrada tool `web_fetch` ao PI para aprofundar fontes retornadas por `web_search`.
- Implementado `ResearchService.fetchUrl()` com extracao de texto e titulo a partir de HTML.
- Adicionado cache por URL em `dataDir/research/fetch-cache.json` com TTL configuravel.
- Expandida configuracao com `KAEL_RESEARCH_FETCH_MAX_CHARS` e `KAEL_RESEARCH_FETCH_CACHE_TTL_MS`.

Arquivos-chave:
- `src/research/service.ts`
- `src/agents/pi-tools.ts`
- `src/config.ts`
- `src/research/service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Sumarizacao/citacao multi-fonte usando conteudo fetched.

Proximo passo recomendado:
- Fase 9.3: sumarizacao com citacoes robustas e score de confianca por evidencia.

### 2026-02-21 - Fase 9.3: web_research (sintese multi-fonte com confianca)

Resumo:
- Criada tool `web_research` no PI para pipeline completo de pesquisa em uma chamada.
- Implementado `ResearchService.research()` com `web_search + web_fetch(top N) + sintese`.
- Adicionado retorno estruturado com `summary`, `evidence`, `confidence` e `confidenceReason`.
- Mantida persistencia/caching da fase anterior para reduzir latencia em pesquisas repetidas.

Arquivos-chave:
- `src/research/service.ts`
- `src/research/types.ts`
- `src/agents/pi-tools.ts`
- `src/agents/types.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Ajustar heuristica de confianca com sinais de recencia/autoridade.

Proximo passo recomendado:
- Fase 9.4: ranking de evidencia e confianca baseada em features de fonte/tempo.

### 2026-02-21 - Fase 9.4 (item 1): SSRF guard em web_fetch

Resumo:
- Implementado guard de SSRF para `web_fetch` com bloqueio de localhost/faixas privadas.
- Redirects passaram a ser manuais com revalidacao de destino a cada salto.
- Adicionada configuracao `KAEL_RESEARCH_FETCH_MAX_REDIRECTS`.

Arquivos-chave:
- `src/research/ssrf-guard.ts`
- `src/research/service.ts`
- `src/config.ts`
- `src/research/ssrf-guard.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Item 2: wrapping de conteudo externo nao confiavel (`web_search`/`web_fetch`).

Proximo passo recomendado:
- Implementar item 2 (external-content wrapping) antes de evoluir ranking/confianca.

### 2026-02-21 - Fase 9.4 (item 2): wrapping de conteudo externo

Resumo:
- Criado wrapper de conteudo externo em `src/security/external-content.ts`.
- Aplicado wrapping em campos textuais de `web_search` (`answer`, `title`, `snippet`).
- Aplicado wrapping em campos textuais de `web_fetch` (`title`, `content`, `excerpt`).
- URLs (`url`, `finalUrl`) permanecem brutas para manter tool chaining seguro e funcional.

Arquivos-chave:
- `src/security/external-content.ts`
- `src/research/service.ts`
- `src/research/types.ts`
- `src/research/service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Item 3: limite de bytes de resposta + warning de truncamento no fetch.

Proximo passo recomendado:
- Implementar item 3 para controlar custo/latencia/contexto de respostas web grandes.

### 2026-02-21 - Fase 9.4 (item 3): limite de resposta + warning

Resumo:
- Implementado limite de bytes lidos em `web_fetch` (`fetchMaxResponseBytes`).
- Adicionado `warning` quando resposta e truncada por limite de bytes.
- Mantido truncamento adicional por `maxChars` para controle final de payload.

Arquivos-chave:
- `src/research/service.ts`
- `src/research/types.ts`
- `src/config.ts`
- `src/research/service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Item 4: extracao mais robusta de conteudo principal (Readability/fallback).

Proximo passo recomendado:
- Implementar item 4 para melhorar qualidade semantica da evidencia.

### 2026-02-21 - Fase 9.4 (item 4): extracao principal de HTML

Resumo:
- Melhorada extracao de `web_fetch` para priorizar conteudo principal em HTML.
- Heuristica implementada: remove blocos de ruido e seleciona melhor candidato entre `article/main/div/section` com sinais de conteudo.
- Mantido fallback seguro para `body` e, por ultimo, limpeza completa do HTML.

Arquivos-chave:
- `src/research/service.ts`
- `src/research/service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Refinar ranking de evidencia/confianca com sinais de recencia/autoridade de dominio.

Proximo passo recomendado:
- Fase 9.5: ranking de evidencia + confianca mais calibrada.

### 2026-02-21 - Fase 9.1: web_search API-first (Tavily + memoria por sessao)

Resumo:
- Criado dominio `src/research` com provider plugavel e implementacao inicial `TavilySearchProvider`.
- Integrada tool `web_search` ao PI com retorno de resumo, fontes e notas.
- Adicionada persistencia de historico de pesquisa por sessao em `dataDir/research/<session>.json`.
- Expandida configuracao para `KAEL_RESEARCH_*` e defaults globais no `~/.kael/config.json`.

Arquivos-chave:
- `src/research/service.ts`
- `src/research/provider.ts`
- `src/agents/pi-tools.ts`
- `src/config.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Re-ranking de fontes por autoridade/recencia.
- Cache compartilhado entre sessoes.

Proximo passo recomendado:
- Fase 9.3: sumarizacao/citacao de conteudo fetched com ranking de evidencia.

### 2026-02-21 - Fase 8.1: planner/executor baseline (plano persistido)

Resumo:
- Implementado `PlannerService` com persistencia local em `plans/plans.json`.
- Integradas tools de plano no PI: `plan_create`, `plan_list`, `plan_update_step`, `plan_next`.
- Expostos endpoints HTTP de planos (`GET/POST /plans`, `GET /plans/:planId`, `POST /plans/:planId/steps/:stepIndex`).
- Ajustada derivacao de status para preservar `canceled` quando todas as etapas forem canceladas.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/agents/pi-tools.ts`
- `src/api/server.ts`
- `docs/architecture/phases/phase-8.1.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Explicar ao PI quando abrir/atualizar plano automaticamente (heuristica inicial).

Proximo passo recomendado:
- Fase 8.2: planner inteligente com checkpoints por execucao e notas de progresso.

### 2026-02-20 - Fase 6: shell tools no PI (exec/process)

Resumo:
- Implementado `ShellToolService` com execucao local de shell, timeout, background e gerenciamento de sessoes.
- Integradas tools `exec` e `process` no `PiEngineAdapter`.
- Implementado `ExecApprovalStore` com politica `security/ask`, allowlist e pendencias em `~/.kael/exec-approvals.json`.
- Expandida configuracao (`KAEL_EXEC_*`) e defaults globais em `~/.kael/config.json`.

Arquivos-chave:
- `src/tools/system/shell-tool-service.ts`
- `src/tools/system/shell-approvals.ts`
- `src/agents/pi-tools.ts`
- `src/agents/pi-engine-adapter.ts`
- `src/config.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Streaming realtime de output (SSE/WebSocket) para substituir polling em parte dos fluxos.

Proximo passo recomendado:
- Fase 7: UX operacional de approvals + stream de eventos/processos.

### 2026-02-20 - Fase 6.1: approvals end-to-end (API + CLI + UI)

Resumo:
- Fechado fluxo de aprovacao manual: listagem, approve e deny via API.
- `exec` passou a aguardar decisao manual por janela configuravel (`KAEL_EXEC_APPROVAL_WAIT_MS`) antes de concluir.
- CLI ganhou comandos para operar approvals sem editar arquivo JSON.
- UI `Ops` ganhou painel de approvals pendentes com acoes de `Approve`/`Deny`.
- Prompt de tools ajustado para orientar uso de `process kill` antes de `exec kill`.

Arquivos-chave:
- `src/tools/system/shell-approvals.ts`
- `src/tools/system/shell-tool-service.ts`
- `src/api/server.ts`
- `src/cli/index.ts`
- `ui/src/pages/OpsPage.tsx`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`
- [x] `npm run ui:check`

Pendencias:
- SSE/WebSocket para eventos de approvals/processos e menor latencia de atualizacao.

Proximo passo recomendado:
- Fase 7: stream realtime de eventos (`/events/stream`) e log follow para jobs/processos.

### 2026-02-20 - Fase 6.2: hardening de approvals/policy (staff pass)

Resumo:
- Policy de allowlist endurecida: bloqueio explicito de sintaxe shell avancada em `security=allowlist`.
- `exec-approvals.json` com escrita atomica e lock para reduzir risco de corrida.
- Novos testes de fluxo completo no `ShellToolService` (approve/deny com espera real de decisao).

Arquivos-chave:
- `src/tools/system/shell-approvals.ts`
- `src/tools/system/shell-tool-service.ts`
- `src/tools/system/shell-approvals.test.ts`
- `src/tools/system/shell-tool-service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Stream realtime (SSE/WebSocket) para reduzir polling de approvals/processos.

Proximo passo recomendado:
- Fase 7: `/events/stream` + log follow realtime.

### 2026-02-20 - Fase 7.0: loop detection para tools de shell

Resumo:
- Implementado `ToolLoopGuard` para detectar repeticao de chamadas `exec/process` sem progresso.
- Integrado no fluxo de tools PI com bloqueio temporario (`cooldown`) e retorno estruturado (`blocked`, `reason`, `retryAfterMs`).
- Cobertura inicial por testes unitarios validando: bloqueio por repeticao, nao bloqueio quando ha progresso e isolamento por sessao/tool.

Arquivos-chave:
- `src/agents/tool-loop-guard.ts`
- `src/agents/tool-loop-guard.test.ts`
- `src/agents/pi-tools.ts`
- `src/agents/pi-engine-adapter.ts`
- `docs/architecture/phases/phase-7.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Calibrar thresholds com feedback de uso real e logs.

Proximo passo recomendado:
- Fase 7.1: context guard + auto-compaction (item 2).

### 2026-02-20 - Fase 7.1: context guard + auto-compaction

Resumo:
- Implementado guard de contexto no `TurnOrchestrator` para detectar crescimento excessivo de historico por mensagens/chars.
- Adicionada auto-compaction com resumo persistido em mensagem `system` (`[compaction]`) para reduzir pressao de contexto.
- Protecao contra compaction repetida em loop (nao compacta quando existe compaction recente na janela).
- Contexto enviado ao engine passou a aceitar `role=system` para carregar resumo compactado.

Arquivos-chave:
- `src/chat/turn-orchestrator.ts`
- `src/chat/turn-orchestrator.test.ts`
- `src/agents/types.ts`
- `docs/architecture/phases/phase-7.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Melhorar qualidade de resumo (hoje heuristico) e calibrar thresholds com telemetria.

Proximo passo recomendado:
- Fase 7.2: SSE de eventos/logs/lifecycle para UX realtime (item 3).

### 2026-02-20 - Fase 8.0: memoria operacional baseline

Resumo:
- Implementado `MemoryService` local-first com markdown como source-of-truth.
- Adicionada separacao de memoria por horizonte:
  - `MEMORY.md` para memoria de longo prazo;
  - `memory/YYYY-MM-DD.md` para memoria diaria.
- Integradas tools no PI:
  - `memory_search` (snippets com path/linhas),
  - `memory_get` (leitura segura),
  - `memory_write` (persistencia explicita daily/long_term).
- `memory_get` foi restringido a `MEMORY.md` e `memory/*.md` dentro do workspace.

Arquivos-chave:
- `src/memory/service.ts`
- `src/memory/service.test.ts`
- `src/agents/pi-tools.ts`
- `src/chat/service.ts`
- `src/app.ts`
- `docs/architecture/phases/phase-8.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Melhorar ranking de busca com recencia e reduzir snippets redundantes.

Proximo passo recomendado:
- Fase 8.1: planner/executor explicito com estado de plano persistido.

### 2026-02-19 - UI-1 (bootstrap): base frontend ops-first em `ui/`

Resumo:
- Criado projeto frontend dedicado em `ui/` com React + Vite + Tailwind.
- Navegacao inicial ops-first implementada (`Ops`, `Jobs`, `Schedules`, `Chat`, `Health`).
- Integracao com API atual via proxy `/api` e polling com TanStack Query.
- Base pronta para evoluir cards operacionais no chat e tempo real (SSE na UI-2).

Arquivos-chave:
- `ui/package.json`
- `ui/src/App.tsx`
- `ui/src/pages/OpsPage.tsx`
- `ui/src/pages/JobsPage.tsx`
- `ui/src/pages/JobDetailPage.tsx`
- `ui/src/pages/SchedulesPage.tsx`
- `ui/src/pages/ChatPage.tsx`
- `ui/src/pages/HealthPage.tsx`
- `ui/src/lib/api.ts`

Checklist de validacao:
- [ ] `npm --prefix ui install`
- [ ] `npm run ui:check`
- [ ] `npm run ui:dev` com backend ativo

Pendencias:
- Adicionar cards de job inline no chat.
- Refinar UX de erro/loading e estados vazios com mais contexto.

Proximo passo recomendado:
- Implementar cards operacionais no chat e acao rapida de abrir job/schedule relacionado.

### 2026-02-19 - UI governance: guia oficial da UI em docs

Resumo:
- Criado guia central da UI com visao ops-first, fases UI-0..UI-3 e checklist de atualizacao por commit.
- Documento desenhado para onboarding rapido de novas instancias de agente.

Arquivos-chave:
- `docs/ui/UI-GUIDE.md`
- `docs/core/START-HERE.md`
- `README.md`

Checklist de validacao:
- [x] Documento versionado em `docs`.
- [x] Referencias adicionadas no onboarding.

Pendencias:
- Iniciar implementacao da UI-1 (MVP operacional web).

Proximo passo recomendado:
- Criar base frontend da UI-1 com Ops Overview + Jobs.

### 2026-02-19 - Fase 5 (incremento): health enriquecido + guardrails de execucao

Resumo:
- `GET /health` evoluido com metricas operacionais de sessoes, jobs e schedules.
- Guardrails de seguranca para jobs de video (paths/URLs/args) com erro de validacao dedicado.
- Config de seguranca adicionada com env vars para roots permitidos e limite de args.
- Testes adicionados para safety e health.

Arquivos-chave:
- `src/tools/video/safety.ts`
- `src/tools/video/video-job-service.ts`
- `src/api/server.ts`
- `src/jobs/store.ts`
- `src/session/store.ts`
- `src/tools/video/safety.test.ts`
- `src/api/server.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Limite de concorrencia e timeout por tipo de job.
- Testes de integracao HTTP focados em falha de seguranca nas rotas `/jobs/*`.

Proximo passo recomendado:
- Implementar controle de concorrencia e budget de runtime por job.

### 2026-02-19 - Fase 5 (incremento): fila de execucao + timeout/cancelamento de jobs

Resumo:
- `VideoJobService` ganhou fila interna com semaforo de concorrencia.
- Jobs agora respeitam limite global de workers concorrentes.
- Timeout de execucao com cancelamento controlado (SIGTERM + grace + SIGKILL).
- Health passou a expor metricas de runtime (`activeJobs`, `queuedJobs`, `maxConcurrentJobs`).

Arquivos-chave:
- `src/tools/video/video-job-service.ts`
- `src/jobs/manager.ts`
- `src/api/server.ts`
- `src/config.ts`
- `src/tools/video/video-job-service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/tools/video/video-job-service.test.ts src/api/server.test.ts src/config.test.ts`

Pendencias:
- Tornar concorrencia e timeout configuraveis por tipo de job.
- Expor cancelamento manual de job via API/CLI.

Proximo passo recomendado:
- Implementar endpoint/CLI de cancelamento de job e testes E2E de `/jobs/*`.

### 2026-02-19 - Fase 5 (incremento): cancelamento manual de jobs (API + CLI)

Resumo:
- Endpoint `POST /jobs/:jobId/cancel` adicionado para cancelar jobs em fila ou em execucao.
- CLI `job-cancel --id <jobId>` adicionada para operacao direta sem `curl`.
- Introduzido status de job `canceled` para representar cancelamento manual de forma explicita.
- Testes de runtime e integracao atualizados para fluxo de cancelamento.

Arquivos-chave:
- `src/tools/video/video-job-service.ts`
- `src/jobs/manager.ts`
- `src/api/server.ts`
- `src/cli/index.ts`
- `src/types.ts`
- `src/tools/video/video-job-service.test.ts`
- `src/api/server.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Expor motivo detalhado de cancelamento no contrato da API (manual x timeout).
- Adicionar cancelamento em lote por sessao (opcional).

Proximo passo recomendado:
- Cobrir E2E completo de `/jobs/*` incluindo validacao de seguranca e cancelamento.

### 2026-02-19 - Fase 5 (incremento): E2E `/jobs/*` (seguranca, timeout, cancelamento)

Resumo:
- Suite E2E dedicada de jobs adicionada com app real de `JobStore + VideoJobService + JobManager`.
- Cobertos cenarios ponta-a-ponta:
  - rejeicao por path inseguro
  - timeout de job com status `failed` e log com marcador de timeout
  - cancelamento de job queued e running com status final `canceled`

Arquivos-chave:
- `src/api/jobs.e2e.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Adicionar asserts E2E de idempotency para `POST /jobs/*`.
- Avaliar cenarios de concorrencia > 1 com multiplos tipos de job.

Proximo passo recomendado:
- Implementar retry/politica operacional por tipo de job (transcode, hls, capture, probe).

### 2026-02-19 - Fase 4.1 (hardening): contrato de erro, validacao de config e logs estruturados

Resumo:
- API padronizada com contrato unico de erro (`status`, `code`, `message`, `details`, `requestId`).
- Validacao de configuracao no startup com falha rapida para casos invalidos.
- Observabilidade inicial com logs JSON em `stdout` para requests HTTP e execucoes do scheduler.
- Testes de integracao HTTP para `/chat` (incluindo idempotency) e `/schedules`.

Arquivos-chave:
- `src/api/server.ts`
- `src/api/errors.ts`
- `src/infra/logger.ts`
- `src/config.ts`
- `src/api/server.test.ts`
- `src/config.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/api/server.test.ts src/config.test.ts src/automation/persistent-scheduler.test.ts`

Pendencias:
- Definir cobertura E2E de jobs (`/jobs/*`) com cenarios de erro reais.
- Expandir `code` de erro para dominio de negocio (quando necessario).

Proximo passo recomendado:
- Avancar para observabilidade expandida (metricas + health com sinais operacionais).

### 2026-02-19 - Fase 4 (incremento): API/CLI de schedules + cron expression

Resumo:
- Scheduler evoluido para dois tipos de agenda (`interval` e `cron`).
- Adicionadas rotas de schedules para listagem, detalhe, upsert, pause e resume.
- Adicionados comandos CLI para operar schedules sem `curl`.
- Incluidos testes focados de `cron` e `PersistentScheduler`.

Arquivos-chave:
- `src/automation/cron.ts`
- `src/automation/persistent-scheduler.ts`
- `src/automation/service.ts`
- `src/api/server.ts`
- `src/cli/index.ts`
- `src/automation/cron.test.ts`
- `src/automation/persistent-scheduler.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/automation/cron.test.ts src/automation/persistent-scheduler.test.ts`

Pendencias:
- Expor operacoes de delete de schedule e execucao manual (`run-now`).
- Evoluir parser cron para ranges/listas se necessario.

Proximo passo recomendado:
- Iniciar Fase 5 com logs estruturados de turno/job e testes de integracao HTTP.

### 2026-02-18 - Fase 4 (incremento): heartbeat + scheduler persistente

Resumo:
- Implementado scheduler persistente com store JSON e tick configuravel.
- Adicionado catch-up basico apos restart para jobs atrasados.
- Criado `HeartbeatRunner` para monitorar mudancas de status de jobs.
- Heartbeat agora notifica a sessao com mensagem de sistema quando job muda para `succeeded`/`failed`.
- Integrado bootstrap automatico no app quando `KAEL_HEARTBEAT_ENABLED=true`.

Arquivos-chave:
- `src/automation/persistent-scheduler.ts`
- `src/automation/heartbeat-runner.ts`
- `src/app.ts`
- `src/config.ts`
- `src/global-config.ts`
- `docs/architecture/phases/phase-4.md`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual: iniciar servidor, rodar job e confirmar mensagem `[heartbeat]` na sessao

Pendencias:
- Evoluir scheduler de intervalo para cron expressions.
- Expor API/CLI de gerenciamento de schedules.

Proximo passo recomendado:
- Iniciar Fase 5 com observabilidade (logs estruturados de turno/job) e testes de integracao.

### 2026-02-18 - Fase 3 (incremento): reset automatico de sessao em falha fatal

Resumo:
- `SessionStore` ganhou operacao de reset por `sessionKey` com novo transcript.
- `ChatService` passou a detectar falhas fatais classificadas e executar reset automatico.
- Apos reset, o turno e reexecutado uma unica vez para recuperar o fluxo.
- Docs de Fase 3 atualizadas para refletir entrega.

Arquivos-chave:
- `src/session/store.ts`
- `src/chat/service.ts`
- `docs/architecture/phases/phase-3.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [ ] `npm run check`
- [ ] teste manual de `/chat` simulando falha fatal para validar reset/retry unico

Pendencias:
- Evoluir idempotency store para persistente (se necessario).
- Adicionar resumo de contexto alem do truncamento por janela.

Proximo passo recomendado:
- Iniciar Fase 4 com heartbeat produtivo e scheduler cron persistente.

### 2026-02-18 - Simplificacao do runtime PI (SDK-only)

Resumo:
- Removidos caminhos `local_process` e `openai_http` para reduzir custo de manutencao.
- `PiEngineAdapter` agora opera exclusivamente com PI SDK embutido.
- Configuracao PI foi simplificada (sem `transport`, `apiUrl` e `local.command/args`).
- Documentacao atualizada com estrategia atual e nota para reintroducao futura se necessario.

Arquivos-chave:
- `src/agents/pi-engine-adapter.ts`
- `src/config.ts`
- `src/global-config.ts`
- `README.md`
- `docs/architecture/phases/phase-2.md`
- `docs/architecture/phases/phase-3.md`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual de `/chat` em `hybrid` confirmando fluxo PI normal

Pendencias:
- Se houver necessidade futura de multiplos transportes, reintroduzir via novo adapter dedicado (nao no caminho principal).

Proximo passo recomendado:
- Continuar Fase 3 com reset controlado de sessao + observabilidade de turnos.

### 2026-02-18 - Fase 3 (incremento): TurnOrchestrator + context guard multi-turn

Resumo:
- Introduzido `TurnOrchestrator` para centralizar preparacao de turnos antes da engine.
- Contexto conversacional agora entra no PI com janela limitada por mensagens e caracteres.
- `PiEngineAdapter` passou a receber historico recente (HTTP como mensagens; SDK/local-process como prompt serializado).

Arquivos-chave:
- `src/chat/turn-orchestrator.ts`
- `src/chat/service.ts`
- `src/agents/types.ts`
- `src/agents/pi-engine-adapter.ts`
- `src/config.ts`
- `src/global-config.ts`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual multi-turn (`/chat`) confirmando continuidade entre mensagens

Pendencias:
- Implementar reset automatico de sessao em falhas fatais.
- Evoluir de truncamento de contexto para resumo de contexto.

Proximo passo recomendado:
- Iniciar proximo incremento com `session reset controlado` + logs estruturados de turno (`turnId`, `fallbackReason`, `retryCount`).

### 2026-02-18 - Bootstrap inicial do projeto

Resumo:
- Implementado core funcional (Fase 0 + Fase 1).
- Corrigido typecheck do `ProcessRunner` (`stdio` com `pipe` para stdin/stdout/stderr).

Arquivos-chave:
- `src/api/server.ts`
- `src/cli/index.ts`
- `src/session/store.ts`
- `src/jobs/store.ts`
- `src/tools/video/transcode-service.ts`
- `src/agents/types.ts`
- `src/agents/simple-engine.ts`

Proximo passo recomendado:
- Iniciar Fase 2 com `PiEngineAdapter` mantendo o contrato de `AgentEngine`.

### 2026-02-18 - Fase 2: engine hibrida + tools de video

Resumo:
- Implementado `PiEngineAdapter` e factory de engine com modos `simple`, `pi` e `hybrid`.
- Expandido job runtime com `convert_hls`, `capture_stream` e `probe_media`.
- Expostos novos endpoints de jobs e atualizado comando `/help` com novas actions.

Arquivos-chave:
- `src/agents/pi-engine-adapter.ts`
- `src/agents/factory.ts`
- `src/agents/hybrid-engine.ts`
- `src/tools/video/video-job-service.ts`
- `src/api/server.ts`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual basico dos comandos slash no fluxo de chat

Pendencias:
- Adicionar testes automatizados da Fase 2.

Proximo passo recomendado:
- Iniciar Fase 3 com retry utilitario e camada de dedupe/idempotency.

### 2026-02-18 - CLI init e home global (~/.kael)

Resumo:
- Adicionado comando `kael init` para bootstrap de configuracao global.
- Implementado carregamento automatico de `~/.kael/config.json` com override por env.
- Criada base para home global com `data` e `logs`.

Arquivos-chave:
- `src/cli/index.ts`

### 2026-02-18 - Fase 3 (incremento): retry + fallback classificado + idempotency

Resumo:
- Implementado retry generico com backoff exponencial + jitter configuravel.
- `PiEngineAdapter` passou a classificar erros e aplicar retry apenas para falhas transientes.
- `HybridEngine` (via factory) agora usa fallback por classe de erro, sem catch generico.
- Rotas criticas ganharam idempotency via `x-idempotency-key` com TTL e resposta replay.

Arquivos-chave:
- `src/infra/retry.ts`
- `src/agents/pi-errors.ts`
- `src/agents/pi-engine-adapter.ts`
- `src/agents/factory.ts`
- `src/infra/idempotency-store.ts`
- `src/api/server.ts`
- `src/config.ts`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual de replay idempotente (`x-idempotency-key`) nas rotas criticas
- [ ] teste manual de fallback classificado no modo `hybrid`

Pendencias:
- Guard de contexto e reset de sessao para completar Fase 3.

Proximo passo recomendado:
- Implementar context guard no fluxo de chat e rotina de reset controlado de sessao em falhas irrecoveraveis.
- `src/global-config.ts`
- `src/config.ts`
- `README.md`

Checklist de validacao:
- [x] `npm run check`
- [x] teste manual de `init` e leitura de config global

Pendencias:
- Validar manualmente fluxo de `init --force` e valores globais.

Proximo passo recomendado:
- Iniciar Fase 3 com retry utilitario e camada de dedupe/idempotency.

### 2026-02-18 - Reorganizacao de docs + arquitetura por fase

Resumo:
- Reorganizados documentos em subpastas (`core`, `planning`, `research`, `architecture`).
- Mantido na raiz apenas `README.md` e `AGENTS.md`.
- Criados documentos incrementais de arquitetura por fase (1, 2, 3).

Arquivos-chave:
- `docs/core/START-HERE.md`
- `docs/planning/PROJECT-STATUS.md`
- `docs/architecture/README.md`
- `docs/architecture/phases/phase-1.md`
- `docs/architecture/phases/phase-2.md`
- `docs/architecture/phases/phase-3.md`

Checklist de validacao:
- [x] paths de onboarding atualizados em `AGENTS.md` e `README.md`
- [x] referencias principais migradas para novos caminhos

Pendencias:
- Revisar periodicamente os docs de fase conforme evolucao do runtime.

Proximo passo recomendado:
- Iniciar Fase 3 no codigo e manter `docs/architecture/phases/phase-3.md` sincronizado durante a implementacao.

### 2026-02-18 - SOUL.md injetado no system prompt do PI

Resumo:
- `system prompt` do `PiEngineAdapter` deixou de ser hardcoded e agora e montado no bootstrap de config.
- Quando existe `docs/core/SOUL.md` (ou `KAEL_SOUL_PATH`), seu conteudo e anexado ao prompt base do Kael.
- Mesmo comportamento vale para os transportes `pi_sdk` e `openai_http`.

Arquivos-chave:
- `src/config.ts`
- `src/agents/pi-engine-adapter.ts`
- `README.md`
- `docs/architecture/phases/phase-2.md`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual do `/chat` validando resposta aderente ao `SOUL.md`

Pendencias:
- Adicionar testes automatizados para garantir montagem do prompt com fallback quando `SOUL.md` nao existir.

Proximo passo recomendado:
- Implementar guard de contexto + reset de sessao (Fase 3) sobre fluxo `pi_sdk`.

### 2026-02-18 - Revisao da abstracao PI: runtime local-first

Resumo:
- Refatorado `PiEngineAdapter` para priorizar runtime local por processo (`stdin/stdout`).
- Mantido `openai_http` apenas como modo legado opcional.
- Config estendida com `KAEL_PI_TRANSPORT`, `KAEL_PI_LOCAL_COMMAND` e `KAEL_PI_LOCAL_ARGS_JSON`.

Arquivos-chave:
- `src/agents/pi-engine-adapter.ts`
- `src/config.ts`
- `src/global-config.ts`
- `README.md`

Checklist de validacao:
- [ ] `npm run check`
- [ ] teste manual do modo `local_process` com comando PI real

Pendencias:
- Conectar runtime local a uma integracao PI nativa (SDK) na fase seguinte.

Proximo passo recomendado:
- Implementar `EmbeddedPiEngine` usando SDK do ecossistema PI (sem shell-out) e manter `local_process` como fallback.

### 2026-02-18 - Fase 2.5: PI SDK embutido (sem dependencia de binario)

Resumo:
- Integrado runtime nativo com `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`.
- Novo transporte default `pi_sdk` (sem exigir comando `pi` no PATH).
- Mantidos transportes de compatibilidade: `local_process` e `openai_http`.
- Bootstrap agora carrega `.env` automaticamente.

Arquivos-chave:
- `src/agents/pi-engine-adapter.ts`
- `src/config.ts`
- `src/global-config.ts`
- `src/app.ts`
- `README.md`

Checklist de validacao:
- [ ] `npm run check`
- [ ] teste manual do `/chat` em `hybrid` com `pi_sdk`

Pendencias:
- Evoluir sessao/contexo do SDK para historico completo multi-turn no adapter.

Proximo passo recomendado:
- Implementar context guard + reset de sessao (pendencias da Fase 3) sobre o caminho `pi_sdk`.

### 2026-02-18 - CLI migrada para commander

Resumo:
- Substituido parser manual da CLI por `commander`.
- Mantidos comandos existentes (`init`, `server`, `chat`, `jobs`) com help/validacao padrao.
- Dependencia `commander` adicionada ao projeto.

Arquivos-chave:
- `src/cli/index.ts`
- `package.json`
- `package-lock.json`

Checklist de validacao:
- [x] `npm run check`
- [x] teste manual de `--help`

Pendencias:
- Nenhuma para esta entrega.

Proximo passo recomendado:
- Iniciar Fase 3 no codigo e manter `docs/architecture/phases/phase-3.md` sincronizado durante a implementacao.

### 2026-02-21 - Refactor estrutural: service layer por dominio (`src/chat`)

Resumo:
- Migrado `ChatService` de `src/services/chat-service.ts` para `src/chat/service.ts`.
- Migrado `TurnOrchestrator` e teste para `src/chat/turn-orchestrator.ts` e `src/chat/turn-orchestrator.test.ts`.
- Atualizados imports da aplicacao e referencias em docs para remover caminhos antigos em `src/services`.
- Formalizada convencao `feature-first` em `docs/architecture/README.md`.

Arquivos-chave:
- `src/chat/service.ts`
- `src/chat/turn-orchestrator.ts`
- `src/chat/turn-orchestrator.test.ts`
- `src/app.ts`
- `docs/architecture/README.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Continuar migracoes futuras para padrao por dominio quando novos modulos surgirem.

Proximo passo recomendado:
- Seguir Fase 8.2 (execucao assistida de planos com acoplamento planner + jobs).

### 2026-02-21 - Fase 8.2: planner inteligente inicial (goal -> plan + checkpoints)

Resumo:
- Adicionado `PlannerService.generate()` para gerar plano persistido a partir de objetivo em linguagem natural.
- Cada etapa passou a manter checkpoints de transicao (`status`, `at`, `notes`) e acumulacao de notas com timestamp.
- Exposta nova tool de PI `plan_generate` para criacao de plano por objetivo durante a conversa.
- Exposto endpoint `POST /plans/generate` para uso por UI/API clients.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/agents/pi-tools.ts`
- `src/agents/types.ts`
- `src/chat/service.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Executor assistido de plano ainda nao vincula step automaticamente a job/process session.

Proximo passo recomendado:
- Fase 8.3: executar step com acoplamento ao runtime (`jobs`/`exec`) e atualizar checkpoints automaticamente.

### 2026-02-21 - Fase 8.3: executor assistido de plano (jobs/exec)

Resumo:
- Implementado `PlannerService.executeNext()` para executar o proximo step (`pending/in_progress`) com heuristica de acao (`probe`, `capture`, `transcode`, `hls`, `exec`, `manual`).
- Steps passaram a guardar `execution` (vinculo operacional com `jobId` ou `exec sessionId`) e checkpoint/notas da tentativa.
- Adicionada normalizacao de planos legados no `init()` para garantir `checkpoints` em registros antigos.
- Exposta tool PI `plan_execute_next`.
- Exposto endpoint `POST /plans/:planId/execute-next`.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/agents/pi-tools.ts`
- `src/agents/types.ts`
- `src/chat/service.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Ainda nao ha reconciliacao automatica para atualizar o step quando `job/exec` termina.

Proximo passo recomendado:
- Fase 8.4: reconciliacao automatica de estado entre runtime (`jobs`/`exec`) e status do step.

### 2026-02-21 - Fase 8.4: reconciliacao automatica de steps (job/exec)

Resumo:
- Implementado `PlannerService.reconcile()` para fechar steps `in_progress` com base no estado final de `job`/`exec` associado.
- `createKaelApp()` agora agenda job persistente `planner.reconcile` no `PersistentScheduler`.
- Configuracao adicionada para reconciler (`KAEL_PLANNER_RECONCILE_ENABLED`, `KAEL_PLANNER_RECONCILE_INTERVAL_MS`).
- Expostos gatilhos operacionais: API `POST /plans/reconcile` e tool PI `plan_reconcile`.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/app.ts`
- `src/config.ts`
- `src/global-config.ts`
- `src/api/server.ts`
- `src/agents/pi-tools.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Atualizacao de step ainda depende de polling do reconciler (latencia do intervalo).

Proximo passo recomendado:
- Fase 8.5: eventos/SSE para reduzir latencia de reconciliacao e alimentar UI em tempo real.

### 2026-02-21 - UI-1 incremento: Plans operacionais na interface

Resumo:
- Adicionada aba/pagina `Plans` no frontend com lista e detalhe de planos.
- Integrado consumo dos endpoints de planner (`GET /plans`, `GET /plans/:id`, `POST /plans/:id/execute-next`, `POST /plans/reconcile`).
- UI agora mostra status dos steps, checkpoints e vinculo de execucao (`job/exec`) por step.
- Acoes operacionais de plano disponiveis na UI: `Execute Next` e `Reconcile`.

Arquivos-chave:
- `ui/src/pages/PlansPage.tsx`
- `ui/src/lib/api.ts`
- `ui/src/App.tsx`
- `ui/src/components/AppShell.tsx`
- `ui/src/lib/format.ts`
- `docs/ui/UI-GUIDE.md`

Checklist de validacao:
- [x] `npm --prefix ui run check`
- [x] `npm --prefix ui run build`

Pendencias:
- Inputs de `execute-next` ainda em JSON livre (UX pode evoluir para formulario tipado).

Proximo passo recomendado:
- UI-2: stream/eventos (SSE) para reduzir dependencia de polling no acompanhamento de planos/jobs.

### 2026-02-21 - UI-1 incremento: decisao de plano no Chat (opt-in com UX guiada)

Resumo:
- Chat ganhou sugestao contextual de planejamento para pedidos multi-etapa.
- Implementado composer de plano no chat (objetivo + max steps) com geracao via `POST /plans/generate`.
- Incluido card de "Plano da sessao" no Chat com status e atalho para a aba Plans.
- Fluxo de decisao ficou explicito: enviar mensagem normal ou criar plano antes.

Arquivos-chave:
- `ui/src/pages/ChatPage.tsx`
- `ui/src/lib/api.ts`
- `docs/ui/UI-GUIDE.md`

Checklist de validacao:
- [x] `npm --prefix ui run check`
- [x] `npm --prefix ui run build`

Pendencias:
- Sinal de recomendacao ainda usa heuristica local (sem classificacao pelo backend/LLM).

Proximo passo recomendado:
- UI-2: usar SSE/eventos para atualizar estado de plano/jobs em tempo real e reduzir polling.

### 2026-02-21 - Planner/UI hardening: cancel plan + shell-plan fixes

Resumo:
- Adicionado cancelamento de plano end-to-end (`POST /plans/:planId/cancel` + botao `Cancel Plan` na UI).
- `PlannerService` ganhou `cancelPlan()` para encerrar todas as etapas e marcar status final `canceled`.
- Melhorada geracao de plano para objetivos shell (`ls/cat/...`) com steps explicitos de comando.
- `execute-next` agora tenta inferir `command` automaticamente do titulo do step de shell quando input nao e enviado.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`
- `ui/src/lib/api.ts`
- `ui/src/pages/PlansPage.tsx`
- `README.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`
- [x] `npm --prefix ui run check`
- [x] `npm --prefix ui run build`

Pendencias:
- Planos antigos com steps genericos ainda podem exigir regeneracao para melhor UX de execucao shell.

Proximo passo recomendado:
- UI-2/SSE para atualizacao de plano e jobs em tempo real sem polling.

### 2026-03-04 - Refactor pre-fase: budget/blocked guard unificado nas PI tools

Resumo:
- Refatorada a criacao de respostas bloqueadas (`blocked=true`) para um helper unico em `pi-tools`.
- Unificado o guard de budget para `exec`, `process`, `web_search`, `web_fetch`, `web_research`, `image_generate` (reduz repeticao e risco de divergencia).
- Mantido comportamento atual de bloqueio/log, incluindo `nextAction` nos tools web e telemetria `onToolEvent`.

Arquivos-chave:
- `src/agents/pi-tools.ts`
- `src/agents/pi-tools.test.ts`
- `src/agents/pi-engine-adapter.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/agents/pi-tools.test.ts src/agents/pi-engine-adapter.test.ts`

Pendencias:
- Ainda ha repeticao de padroes de loop-guard entre tools; proximo passo e extrair helper dedicado para esse trecho.

Proximo passo recomendado:
- Refactor 2: politica de timeout central por tipo de operacao (`pi`, `media`, `image_generation`, `email`).

### 2026-03-04 - Refactor pre-fase: politica de timeout centralizada

Resumo:
- Centralizado parsing/resolucao de timeouts em `resolveTimeoutPolicy()` no `config.ts`.
- Unificada a politica de timeout para operacoes criticas: `pi`, `research`, `media`, `image_generation`, `email_pop3`, `email_smtp`.
- Mantidas as mesmas env vars existentes (`KAEL_PI_TIMEOUT_MS`, `KAEL_MEDIA_TIMEOUT_MS`, `KAEL_IMAGE_GENERATION_TIMEOUT_MS`, `KAEL_EMAIL_GMAIL_TIMEOUT_MS`, `KAEL_EMAIL_GMAIL_SMTP_TIMEOUT_MS`, `KAEL_RESEARCH_TIMEOUT_MS`), sem quebra de compatibilidade.

Arquivos-chave:
- `src/config.ts`
- `src/config.test.ts`
- `src/api/server.test.ts`
- `src/api/jobs.e2e.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/config.test.ts src/api/server.test.ts src/api/jobs.e2e.test.ts`

Pendencias:
- Timeouts de shell/video ainda usam politica propria (intencional); pode haver convergencia futura em um timeout registry unico.

Proximo passo recomendado:
- Refactor 3: lock distribuido de ingest de email para evitar processamento duplicado em multiplos workers.

### 2026-03-04 - Refactor pre-fase: lock distribuido no email ingest

Resumo:
- Implementado `FileEmailIngestDedupeStore` com lock atomico por mensagem (`provider:id`) e marcador persistente de processado.
- Integrado no `EmailIngestService` com skip explicito de duplicados (`duplicate`/`in_flight`) e log estruturado `email.ingest.duplicate_skipped`.
- `createKaelApp()` agora inicializa dedupe store em `dataDir/email/ingest-dedupe` para evitar processamento duplicado quando ha mais de um worker/processo ativo.

Arquivos-chave:
- `src/email/ingest-dedupe-store.ts`
- `src/email/ingest-service.ts`
- `src/email/ingest-service.test.ts`
- `src/app.ts`
- `docs/architecture/phases/phase-14.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/email/ingest-service.test.ts src/email/gmail-pop3-provider.test.ts src/api/server.test.ts`

Pendencias:
- Ainda falta expor metricas de dedupe no `/health` para observabilidade de producao.

Proximo passo recomendado:
- Incluir contadores de dedupe/inflight no `health` e painel de observabilidade.

### 2026-03-04 - Observabilidade: metricas de email ingest no /health

Resumo:
- `EmailIngestService` ganhou telemetria de runtime (`polls`, `messagesSeen`, `processed`, `duplicateSkipped`, `inFlightSkipped`, `lastPollAt`).
- `KaelApp` passa a expor `emailIngest` (opcional) para observabilidade.
- `/health` agora inclui `metrics.emailIngest` quando o ingest de email estiver ativo.
- Cobertura de testes atualizada para garantir contrato de metricas no health e contadores no ingest.

Arquivos-chave:
- `src/email/ingest-service.ts`
- `src/app.ts`
- `src/api/server.ts`
- `src/email/ingest-service.test.ts`
- `src/api/server.test.ts`
- `docs/architecture/phases/phase-14.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test -- src/api/server.test.ts src/email/ingest-service.test.ts`

Pendencias:
- Falta levar `metrics.emailIngest` para painel visual/alertas (alem do endpoint).

Proximo passo recomendado:
- Exibir `emailIngest` na UI de health/ops com alertas para crescimento de `duplicateSkipped` e `inFlightSkipped`.

### 2026-03-04 - UI Ops/Health: telemetria de email ingest com alertas

Resumo:
- Atualizado contrato de frontend (`HealthSchema`) para incluir `metrics.emailIngest`.
- `OpsPage` agora exibe contadores de ingest de email e sinaliza alerta quando `duplicateSkipped`/`inFlightSkipped` passam do limiar.
- `HealthPage` ganhou painel dedicado `Email Ingest` com `polls`, `messagesSeen`, `processed`, `duplicateSkipped`, `inFlightSkipped` e `lastPollAt`.

Arquivos-chave:
- `ui/src/lib/api.ts`
- `ui/src/pages/OpsPage.tsx`
- `ui/src/pages/HealthPage.tsx`

Checklist de validacao:
- [x] `npm --prefix ui run check`
- [x] `npm --prefix ui run build`

Pendencias:
- Limiar de alerta ainda e estatico na UI; ideal mover para config remota/feature flag.

Proximo passo recomendado:
- Adicionar cards de tendencia (janela temporal) para dedupe/in-flight usando historico de eventos.

### 2026-03-04 - UI Ops/Health: limiares de alerta configuraveis por env

Resumo:
- Extraida leitura de limiares de alerta de email ingest para helper unico no frontend.
- `OpsPage` e `HealthPage` agora usam configuracao por env com fallback seguro.
- Novas envs de UI: `VITE_EMAIL_DUPLICATE_ALERT_THRESHOLD` e `VITE_EMAIL_INFLIGHT_ALERT_THRESHOLD`.

Arquivos-chave:
- `ui/src/lib/email-ingest-alerts.ts`
- `ui/src/pages/OpsPage.tsx`
- `ui/src/pages/HealthPage.tsx`
- `ui/src/vite-env.d.ts`

Checklist de validacao:
- [x] `npm --prefix ui run check`
- [x] `npm --prefix ui run build`

Pendencias:
- Ainda falta historico temporal para reduzir falso-positivo de alerta por pico pontual.

Proximo passo recomendado:
- Incluir tendencia (ultimos N polls) no backend e renderizar sparkline simples na UI de Ops.

### 2026-06-27 - Simplificacao: remocao de manifestAudit / manifestDiff

Fase impactada: 20 (Video capabilities)

Entrega:
- Removido `manifestAudit` e `manifestDiff` do runtime, app, tooling, CLI e agent tools.
- Removidos tipos `HlsManifestAuditInput`, `HlsManifestAuditReport`, `HlsManifestDiffInput`, `HlsManifestDiffReport`.
- Removido arquivo `src/cli/manifest-commands.ts` e registro no CLI.
- Removidas tools PI `video_manifest_audit` e `video_manifest_diff`.
- `videoInspect` (MediaInspector) mantido como unica forma de inspecao de HLS/midia.

Pendencias: Nenhuma.

Proximo passo: Seguir com o roadmap atual.
