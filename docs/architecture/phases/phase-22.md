# Arquitetura - Fase 22 (Stream Watch & Quality Monitor)

Status: em andamento

## Objetivo

Transformar o Kael num agente que **fica assistindo** um stream ao vivo, detectando
problemas de qualidade em tempo real por inspeção contínua do manifesto HLS.

A ideia central: o agente recebe uma URL de manifesto, inicia uma sessão de watch,
e o Kael passa a fazer polling periódico comparando snapshots consecutivos para
identificar anomalias sem precisar de player ou client de vídeo.

## Categorias de problemas detectados (evolutiva)

| Categoria | Código | Como detectar | Fase |
|-----------|--------|---------------|------|
| Discontinuidade inserida | `discontinuity_inserted` | Novo `#EXT-X-DISCONTINUITY` ou salto em `EXT-X-DISCONTINUITY-SEQUENCE` | 22.0 |
| Gap de mediaSequence | `media_sequence_gap` | Avanço acima de `elapsed/targetDuration`, com tolerância mínima/proporcional | 22.0 |
| Manifest congelado (stale) | `stale_manifest` | mediaSequence não avançou após 2x targetDuration | 22.0 |
| Duração de segmento anômala | `segment_duration_anomaly` | Segmento < 30% ou > 150% do targetDuration | 22.0 |
| Gap de áudio (rendição) | `audio_rendition_gap` | Rendição de áudio não declarada ou URI faltando | 22.0 |
| Regressão de ladder ABR | `abr_ladder_regression` | Variantes removidas ou bandwidth reduzido entre polls | 22.1 |
| Lipsync drift | `lipsync_drift` | PTS comparison via ffprobe entre trilha de vídeo e áudio | 22.2 |
| Erro de segmento HTTP | `segment_fetch_error` | HTTP 4xx/5xx ao tentar buscar segmento amostrado | 22.2 |
| Keyframe irregularity | `keyframe_gap` | GOP irregular via ffprobe keyframe timestamps | 22.2 |

## Decisão arquitetural

- O monitoramento é uma **sessão leve de JavaScript** (polling + análise), não um processo externo.
  Não usa o `ProcessJobService` — tem seu próprio lifecycle.
- `HlsWatchService` do VHS gerencia sessões de watch com UUID, start/stop/status.
- `analyzeSnapshotTransition` do VHS é **stateless**: recebe dois snapshots
  consecutivos e retorna eventos. Isso garante testabilidade unitária sem mocks de I/O.
- `MediaInspector.inspectHls()` do VHS é o primitivo de fetch/parse.
- Kael mantém somente `HlsStreamMonitorService`, um adaptador fino que associa
  uma watch à `sessionKey` do agente.
- A API expõe `/streams/watch` como namespace dedicado, separado de `/jobs`.
- A partir de 22.1, `/streams/watch` aceita perfis:
  - `manifest`: watch leve original, em memória, com polling de manifesto.
  - `chunks`: para live, o VHS faz polling incremental, baixa apenas segmentos novos e analisa cada chunk com ffprobe durante a janela de watch; para VOD/janela finita, o Kael ainda usa clone/analyze como compatibilidade.
  - `full`: variante mais pesada de `chunks`, com amostragem maior de playlists; `allVariants` continua explícito para evitar custo alto por padrão.
- Perfis `chunks`/`full` gravam metadados em `stream-watch/<watchId>/`, report JSON/HTML e `expiresAt`
  para cleanup padrão em 24h.
- O status de `chunks`/`full` expõe `currentChunk` e `recentChunks`; a runtime UI mostra os últimos 5 chunks com fase, bytes, duração, codec, continuidade, keyframes e erros, evitando duplicar o chunk atual.
- Cada chunk pode conter `streams[]` com probes separados por elementary stream (`v:0`, `a:0`), incluindo codec/type, PTS/DTS inicial/final, samples, duração e keyframes quando aplicável.
- O watch calcula deltas de lipsync (`audio PTS - video PTS`) por chunk, deltas de boundary por stream contra o chunk anterior (`previousPtsDeltaSeconds` + `ok|gap|overlap|reset|unknown`) e o delta agregado de borda A/V (`avBoundaryDeltaSeconds`) para detectar drift de lipsync entre chunks.
- O status também expõe `manifestReports[]`, com HTTP status, tempo até headers, primeiro byte, download time, bytes, target duration, max segment duration, media sequence delta e discontinuities por playlist auditada.
- Métricas de manifesto distinguem `bodyTimeMs` do tempo total; respostas com headers/primeiro byte altos mas corpo rápido e dentro de janela compatível com live são classificadas como `held`, não como erro crítico.
- A validação de `MEDIA-SEQUENCE` por playlist usa o intervalo real entre leituras e `targetDuration`; avanços grandes só viram `gap` quando excedem o avanço esperado mais tolerância.
- Em master playlists, `profile=full` ou `allVariants=true` habilita `abrReports[]`: o VHS seleciona low/high bitrate, baixa o mesmo `MEDIA-SEQUENCE` comum, probeia vídeo e valida PTS start <= 16ms, duração <= 5ms e GOP começando em keyframe.
- A regra `media_sequence_gap` compara o avanço do `MEDIA-SEQUENCE` contra `elapsed/targetDuration`; assim polls atrasados normais, como 21 segmentos em ~65s com `targetDuration=3.2`, não viram falso gap.
- A UI expõe `/streams/watch` para criação/listagem e `/streams/watch/:watchId` para acompanhamento com cards runtime.

## Estrutura de arquivos (22.0)

```
../vhs/src/
  watch.ts                     # serviço stateful de polling
  watch-rules.ts               # snapshots + análise stateless de transição

src/vhs/
  watch-registry.ts            # adaptador VHS -> sessionKey

src/api/routes/
  stream-watch.ts             # rotas POST/GET /streams/watch

src/tools/pi/
  video.ts                    # + tool video_stream_watch

ui/src/pages/
  StreamWatchPage.tsx         # criação/listagem de watches
  StreamWatchDetailPage.tsx   # status, eventos e report
```

## Nota de runtime (2026-07-13)

- O core ativo usa um unico `AgentRuntime` como objeto de composicao para o chat e para as tools PI.
- `ChatService` recebe apenas `AgentRuntime`; dependencias como `sessions`, `orchestrator`, `media` e `skills` vivem dentro desse runtime.
- A separacao entre chat com atalhos operacionais e chat sem atalhos fica por politica de chamada (`allowOperationalShortcuts`), nao por runtime ou metodo paralelo.

## Fluxo de dados (22.0)

```
Agent / API
    |
    | POST /streams/watch { url, pollIntervalMs }
    v
Kael HlsStreamMonitorService.startWatch()
    |
    |-- loop: setInterval(pollIntervalMs) ---->
    |                                          |
    |                                 VHS MediaInspector.inspectHls(url)
    |                                          |
    |                                 toSnapshot(inspectResult)
    |                                          |
    |                                 VHS analyzeSnapshotTransition(prev, next)
    |                                          |
    |                                 eventos acumulados na sessão
    |
    | GET /streams/watch/:id
    v
StreamWatchStatus { events, pollCount, running, ... }
```

## Contratos canônicos (22.0)

```typescript
type StreamSnapshot = {
  fetchedAt: number;          // Date.now()
  mediaSequence: number;
  discontinuitySequence: number;
  targetDuration: number;
  segments: Array<{ uri: string; duration?: number }>;
  discontinuities: number[];  // índices no array de segmentos
  hasAudioRenditions: boolean;
  audioRenditionCount: number;
};

type StreamWatchEvent = {
  code: string;
  severity: "info" | "warning" | "error";
  summary: string;
  evidence: string[];
  detectedAt: string;  // ISO
};

type StreamWatchStatus = {
  id: string;
  url: string;
  startedAt: string;
  lastPollAt: string | null;
  pollCount: number;
  errorCount: number;
  events: StreamWatchEvent[];
  running: boolean;
};
```

## Proximos incrementos

1. Persistir/recarregar sessões live incrementais do VHS após restart, preservando `seenSegments` e últimos chunks.
2. **22.2**: Amostragem de segmento via ffprobe para lipsync drift e keyframe irregularity.
3. **22.3**: Integração com planner — criar steps automáticos de investigação quando evento de severidade `error` é detectado.
4. **22.4**: Skill dedicada `stream-quality-advisor` com heurísticas de diagnóstico por tipo de problema.
