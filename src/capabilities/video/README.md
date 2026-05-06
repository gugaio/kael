# Video Capability

Modulo central de operacoes de video do Kael, responsavel por jobs de processamento, inspecao de midia, auditoria de manifestos HLS e analise de playback.

## Arquitetura

```
+----------------------+       +------------------+
|   VideoJobCapability |------>|  VideoJobService |
| (JobCapability)      |       |  (executor)      |
+----------------------+       +--------+---------+
                                     |
        +----------------------------+----------------------------+
        |                            |                            |
        v                            v                            v
+---------------+          +------------------+          +-----------------+
| jobs/safety   |          | inspect-service  |          | playback-triage |
| (validacoes)  |          | (probe/HLS)      |          | (analise)       |
+---------------+          +--------+---------+          +--------+--------+
                                    |                             |
                                    v                             v
                           +------------------+          +-----------------+
                           | manifest-audit   |          | config-advisor  |
                           | (auditoria HLS)  |          | (tuning)        |
                           +--------+---------+          +--------+--------+
                                    |                             |
                                    v                             v
                           +------------------+          +-----------------+
                           | manifest-diff    |          | playback-adapters
                           | (comparacao)     |--------->| (hlsjs, etc)    |
                           +------------------+          +-----------------+

+-------------------+       +----------------------+
| artifacts-service |<------| generation-service   |
| (persistencia)    |       | (geracao de midia)   |
+-------------------+       +----------------------+
```

## Componentes

### job-capability.ts

Entry point da capability, implementa `JobCapability` para integracao com o sistema de jobs.

**Acoes disponiveis:**

| Acao | Comando | Descricao |
|------|---------|-----------|
| `transcode` | ffmpeg | Transcodifica video (H.264/AAC por padrao) |
| `convert_hls` | ffmpeg | Converte arquivo para HLS (remux) |
| `capture_stream` | ffmpeg | Captura stream remoto para arquivo |
| `probe_media` | ffprobe | Inspeciona arquivo local (JSON) |
| `probe_url` | ffprobe | Inspeciona stream remoto (JSON) |
| `play_vlc` | vlc | Abre midia no VLC player |

```typescript
import { VideoJobCapability, VIDEO_JOB_ACTIONS } from "./capabilities/video";

const capability = new VideoJobCapability(videoJobService);

// Executar transcode
const job = await capability.actions.transcode({
  sessionKey: "sessao-123",
  inputPath: "/data/input.mp4",
  outputPath: "/data/output.mp4",
  args: ["-c:v", "libx265", "-crf", "23"]
});
```

### job-service.ts

Executor de jobs com fila, concorrencia controlada, timeout e logs persistentes.

**Features:**
- Fila de jobs com limite de concorrencia (`maxConcurrentJobs`)
- Timeout configuravel (`jobTimeoutMs`)
- Graceful shutdown com SIGTERM -> SIGKILL
- Logs gravados em arquivos dedicados por job
- Metricas de runtime via `getRuntimeStats()`

**Dependencias:**
- `JobStore` - persistencia de estado dos jobs
- `ProcessRunner` - spawn de processos ffmpeg/ffprobe/vlc

```typescript
const videoService = new VideoJobService(jobStore, processRunner, {
  safePathsEnabled: true,
  allowedPaths: ["/data/videos", "/tmp"],
  maxJobArgs: 32,
  maxConcurrentJobs: 2,
  jobTimeoutMs: 300_000, // 5 minutos
  killGraceMs: 5_000
});

const job = await videoService.startTranscode({
  sessionKey: "sessao-123",
  inputPath: "/data/input.mp4",
  outputPath: "/data/output.mp4"
});
```

### safety.ts

Validacoes de seguranca para jobs de video.

**Validadores:**
- `validateExistingInputPath()` - garante que arquivo existe e esta em diretorio permitido
- `validateOutputPath()` - garante que destino esta em diretorio permitido
- `validateStreamUrl()` - valida protocolos (http/https/rtsp/rtmp/udp)
- `validateUserArgs()` - bloqueia args perigosos (`-i`, `-y`) e limita quantidade

**Excecao:**
- `VideoJobValidationError` - lancada quando validacao falha

```typescript
import { validateExistingInputPath, VideoJobValidationError } from "./safety";

try {
  await validateExistingInputPath({
    value: "/data/input.mp4",
    label: "inputPath",
    allowedRoots: ["/data"],
    safePathsEnabled: true
  });
} catch (e) {
  if (e instanceof VideoJobValidationError) {
    console.error("Validacao falhou:", e.message);
  }
}
```

### job-contracts.ts

Parsers type-safe para parametros de cada acao de job.

**Funcoes:**
- `parseStartTranscodeParams()`
- `parseStartConvertHlsParams()`
- `parseStartCaptureStreamParams()`
- `parseStartProbeMediaParams()`
- `parseStartProbeUrlParams()`
- `parseStartPlayVlcParams()`

```typescript
import { parseStartTranscodeParams } from "./job-contracts";

const params = parseStartTranscodeParams(unknownInput);
// params: { sessionKey, inputPath, outputPath, args? }
```

### inspect-service.ts

Inspecao de midia local/remota e parsing de manifestos HLS.

**Metodos:**
- `inspectHls(url, options)` - analisa manifesto HLS (master ou media)
- `probe(input, options)` - executa ffprobe e retorna metadados

**Retorno de `inspectHls`:**
```typescript
{
  ok: boolean;
  url: string;
  finalUrl: string;           // URL final apos redirects
  playlistType: "master" | "media" | "unknown";
  variants: HlsVariant[];     // streams de video
  renditions: HlsRendition[]; // audio/legenda
  segments: HlsSegment[];     // segmentos (limitado)
  targetDuration?: number;
  mediaSequence?: number;
  errors: string[];
}
```

**Retorno de `probe`:**
```typescript
{
  ok: boolean;
  input: string;
  timeoutMs: number;
  format?: unknown;      // metadados do container
  streams?: unknown[];   // metadados de cada stream
  keyframes?: {          // opcional, se keyframes=true
    streamSelector: string;
    count: number;
    timestamps: number[];
  };
  errors: string[];
}
```

```typescript
const inspect = new VideoInspectToolService();

// Inspecionar manifesto HLS
const hls = await inspect.inspectHls({
  url: "https://example.com/stream.m3u8",
  maxSegments: 20,
  timeoutMs: 15_000
});

// Probe de arquivo local com keyframes
const probe = await inspect.probe({
  input: "/data/video.mp4",
  keyframes: true,
  maxKeyframes: 50
});
```

### manifest-audit-service.ts

Auditoria profunda de manifestos HLS com deteccao de problemas.

**Metodos:**
- `auditHlsManifest(input)` - audita manifesto e opcionalmente suas variants

**Checks realizados:**
- Master playlist sem variants
- Variant unica (sem ABR)
- BANDWIDTH/CODECS faltando
- Grupos de audio inexistentes
- TARGETDURATION faltando ou muito alto
- Segmentos excedendo TARGETDURATION
- Variacao alta de duracao de segmentos
- Resolucoes duplicadas na ladder
- Codecs inconsistentes entre variants

**Retorno:**
```typescript
{
  ok: boolean;
  url: string;
  finalUrl: string;
  playlistType: "master" | "media" | "unknown";
  summary: string;
  stats: {
    variants: number;
    renditions: number;
    segments: number;
    variantsAudited: number;
    variantsWithErrors: number;
    targetDuration?: number;
    maxSegmentDuration?: number;
    minSegmentDuration?: number;
    averageSegmentDuration?: number;
  };
  issues: ManifestAuditIssue[];
  variantAudits: HlsVariantAuditReport[];
  aggregateIssues: ManifestAuditIssue[];
  recommendations: string[];
}
```

```typescript
const audit = new VideoManifestAuditService(inspectService);

const report = await audit.auditHlsManifest({
  sessionKey: "sessao-123",
  url: "https://example.com/stream.m3u8",
  maxSegments: 20,
  timeoutMs: 15_000,
  followVariants: true,  // auditar variants tambem
  maxVariants: 4
});

if (!report.ok) {
  console.log("Problemas encontrados:");
  report.issues.forEach(i => console.log(`  [${i.severity}] ${i.summary}`));
  console.log("Recomendacoes:", report.recommendations);
}
```

### playback-triage-service.ts

Analisa sessoes de playback para detectar problemas.

**Metodos:**
- `analyzeSession(input)` - analisa eventos/logs de uma sessao

**Input:**
```typescript
{
  sessionKey: string;
  player: "generic" | "avplayer" | "exoplayer" | "hlsjs" | "shaka";
  source?: string;
  streamUrl?: string;
  logText?: string;      // logs brutos do player
  events?: PlaybackEvent[]; // ou eventos estruturados
}
```

**Problemas detectados:**
- Erros fatais de playback
- Rebuffering/stalls
- Startup lento (>3s)
- Problemas especificos do player (hls.js, etc)

**Retorno:**
```typescript
{
  ok: boolean;
  player: PlaybackEngine;
  source?: string;
  streamUrl?: string;
  summary: string;
  metrics: {
    eventCount: number;
    errorCount: number;
    fatalErrorCount: number;
    rebufferCount: number;
    startupTimeMs?: number;
  };
  issues: PlaybackIssue[];
  recommendations: string[];
}
```

```typescript
const triage = new PlaybackTriageService();

const analysis = triage.analyzeSession({
  sessionKey: "sessao-123",
  player: "hlsjs",
  streamUrl: "https://example.com/stream.m3u8",
  logText: hlsJsLogContent
});

console.log(analysis.summary);
// "Analise de playback para hlsjs: sessao classificada como erro."
```

### playback-adapters/hlsjs.ts

Parser especifico para logs do hls.js.

**Funcoes:**
- `parseHlsJsLogText(logText)` - converte logs em eventos estruturados
- `deriveHlsJsIssues(events)` - detecta problemas especificos do hls.js

**Problemas detectados:**
- `manifest_load_error` - erro ao carregar manifesto
- `frag_load_error` - erro ao carregar fragmento
- `level_switch_oscillation` - oscilacao de ABR

```typescript
import { parseHlsJsLogText, deriveHlsJsIssues } from "./playback-adapters/hlsjs";

const events = parseHlsJsLogText(logContent);
const issues = deriveHlsJsIssues(events);
```

### artifacts-service.ts

Persiste artefatos de midia gerados (imagens/videos).

**Metodos:**
- `init()` - cria diretorio raiz
- `saveGeneratedArtifact(params)` - salva artefato e metadados

**Estrutura de armazenamento:**
```
<rootDir>/
  <sessionKey>/
    <uuid>.png       # arquivo
    <uuid>.json      # metadados
```

**Metadados salvos:**
```typescript
{
  id: string;
  sessionKey: string;
  kind: "image" | "video";
  provider: string;
  prompt: string;
  fileName: string;
  filePath: string;
  metadataPath: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
}
```

```typescript
const artifacts = new VideoArtifactsService("/data/artifacts");
await artifacts.init();

const record = await artifacts.saveGeneratedArtifact({
  sessionKey: "sessao-123",
  prompt: "Um gato no espaco",
  provider: "openai",
  artifact: {
    kind: "image",
    fileName: "cat.png",
    mimeType: "image/png",
    dataBase64: "..."
  }
});
```

### generation-service.ts

Interface para geracao de midia via providers externos.

**Implementacoes:**
- `ProviderBackedVideoGenerationService` - usa `ImageGeneratorService` real
- `NoopVideoGenerationService` - desabilitado (para testes/dev)

**Metodos:**
- `generateImage(params)` - gera imagem
- `generateVideo(params)` - gera video (nao implementado)

```typescript
const generation = new ProviderBackedVideoGenerationService(
  imageGenerator,
  artifactsService,
  { imageProvider: "openai" }
);

const result = await generation.generateImage({
  sessionKey: "sessao-123",
  prompt: "Um gato astronauta",
  size: "1024x1024"
});

console.log(result.record.filePath);
```

## Tipos Principais

### types.ts

Tipos exportados pelo modulo:

| Tipo | Uso |
|------|-----|
| `PlaybackEngine` | Players suportados: generic, avplayer, exoplayer, hlsjs, shaka |
| `PlaybackEvent` | Evento de playback com timestamp, categoria, nome |
| `PlaybackIssue` | Problema detectado com codigo, severidade, evidencia |
| `PlaybackAnalysisReport` | Relatorio completo de analise de sessao |
| `HlsManifestAuditInput` | Parametros de auditoria de manifesto |
| `HlsManifestAuditReport` | Relatorio de auditoria de manifesto |
| `HlsVariantAuditReport` | Relatorio de auditoria de variant especifica |
| `ManifestAuditIssue` | Problema em manifesto com codigo, severidade, evidencia |
| `VideoGenerationRequest` | Requisicao de geracao de midia |
| `StoredArtifactRecord` | Registro de artefato persistido |

## Integracao com o Sistema

### Bootstrap (src/bootstrap/runtime.ts)

```typescript
import { VideoCapability, VideoJobService } from "../capabilities/video";

const video = new VideoJobService(jobStore, runner, {
  safePathsEnabled: config.safePathsEnabled,
  allowedPaths: config.allowedPaths,
  maxJobArgs: 32,
  maxConcurrentJobs: 2,
  jobTimeoutMs: 300_000,
  killGraceMs: 5_000
});

const jobs = new JobManager(jobStore, [
  new VideoCapability(video)
]);
```

### API (src/app.ts)

```typescript
import { PlaybackTriageService } from "./capabilities/video";

const triage = new PlaybackTriageService();

// Endpoint de analise de playback
app.post("/api/playback/analyze", async (req, res) => {
  const report = triage.analyzeSession(req.body);
  res.json(report);
});
```

### Planner (src/planner/runtime.ts)

```typescript
import { VIDEO_JOB_ACTIONS } from "../capabilities/video";

// Acoes disponiveis para planejamento
const videoActions = Object.values(VIDEO_JOB_ACTIONS);
```

### Agents (src/agents/types.ts)

```typescript
import type { GeneratedMediaKind } from "../capabilities/video";

// Tipo de artefatos gerados pela engine
type EngineOutputArtifact = {
  kind: GeneratedMediaKind;
  // ...
};
```

## Exemplos de Uso

### 1. Transcodificar video

```typescript
const job = await videoService.startTranscode({
  sessionKey: "transcode-001",
  inputPath: "/data/input.mp4",
  outputPath: "/data/output.mp4",
  args: ["-c:v", "libx265", "-crf", "23", "-preset", "slow"]
});

// Acompanhar status
const status = jobStore.get(job.id);
console.log(status.status); // "queued" | "running" | "succeeded" | "failed"
```

### 2. Converter para HLS

```typescript
const job = await videoService.startConvertHls({
  sessionKey: "hls-001",
  inputPath: "/data/input.mp4",
  outputPlaylistPath: "/data/hls/stream.m3u8",
  segmentTime: 6 // segundos
});
```

### 3. Capturar stream ao vivo

```typescript
const job = await videoService.startCaptureStream({
  sessionKey: "capture-001",
  streamUrl: "https://example.com/live/stream.m3u8",
  outputPath: "/data/capture.ts",
  durationSeconds: 300 // 5 minutos
});
```

### 4. Auditar manifesto HLS

```typescript
const audit = new VideoManifestAuditService(inspectService);

const report = await audit.auditHlsManifest({
  sessionKey: "audit-001",
  url: "https://example.com/stream.m3u8",
  followVariants: true,
  maxVariants: 4
});

if (!report.ok) {
  console.error("Manifesto com problemas:");
  report.issues.forEach(issue => {
    console.error(`[${issue.severity}] ${issue.code}: ${issue.summary}`);
    console.error("  Evidencia:", issue.evidence);
  });
}
```

### 5. Analisar sessao de playback

```typescript
const triage = new PlaybackTriageService();

const report = triage.analyzeSession({
  sessionKey: "playback-001",
  player: "hlsjs",
  streamUrl: "https://example.com/stream.m3u8",
  logText: `
    [100ms] manifest loaded
    [250ms] frag loaded
    [300ms] playing
    [5000ms] buffer stall
    [5200ms] frag_load_error fatal:true
  `
});

console.log(report.summary);
// "Analise de playback para hlsjs: sessao classificada como erro."

console.log(report.metrics);
// { eventCount: 5, errorCount: 1, fatalErrorCount: 1, rebufferCount: 1, startupTimeMs: 300 }
```

## Testes

Arquivos de teste acompanham cada componente:

- `job-capability.test.ts` - testes da capability
- `job-service.test.ts` - testes do executor de jobs
- `safety.test.ts` - testes de validacao
- `artifacts-service.test.ts` - testes de persistencia
- `generation-service.test.ts` - testes de geracao
- `manifest-audit-service.test.ts` - testes de auditoria
- `playback-triage-service.test.ts` - testes de analise de playback

Executar testes:
```bash
npm test src/capabilities/video/
```
