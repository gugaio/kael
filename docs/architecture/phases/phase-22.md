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
| Gap de mediaSequence | `media_sequence_gap` | Salto maior que o esperado entre polls | 22.0 |
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
```

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

1. **22.1**: Detecção de regressão de ladder ABR entre polls (variantes removidas, bandwidth dropping).
2. **22.2**: Amostragem de segmento via ffprobe para lipsync drift e keyframe irregularity.
3. **22.3**: Integração com planner — criar steps automáticos de investigação quando evento de severidade `error` é detectado.
4. **22.4**: Skill dedicada `stream-quality-advisor` com heurísticas de diagnóstico por tipo de problema.
