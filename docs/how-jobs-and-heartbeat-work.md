# Como Funcionam Jobs e Heartbeat no Kael

Este documento explica a arquitetura de jobs de vídeo, ciclo de vida e o sistema de heartbeat que monitora mudanças de status.

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura de Jobs](#arquitetura-de-jobs)
3. [Ciclo de Vida de um Job](#ciclo-de-vida-de--job)
4. [Como Funciona o Heartbeat](#como-funciona-o-heartbeat)
5. [Exemplos de Fluxo Completo](#exemplos-de-fluxo-completo)
6. [Configuração](#configuração)

---

## Visão Geral

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Kael - Sistema de Jobs                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐      ┌─────────────┐                │
│  │   JobStore  │      │ ProcessJobs │                │
│  │ (Persistência) │──────▶│(Execução)   │                │
│  └─────────────┘      └─────────────┘                │
│         │                     │                            │
│         ▼                     ▼                            │
│  ┌─────────────┐                                        │
│  │ Video jobs  │◀───── API pública                 │
│  │ (builders)  │                                        │
│  └─────────────┘                                        │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────┐                                        │
│  │ HeartbeatRunner│◀───── Monitoramento           │
│  └─────────────────┘                                        │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐                                        │
│  │ PersistentSch│◀───── Agendamento                │
│  │ eduler      │                                        │
│  └──────────────┘                                        │
│                                                              │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Arquitetura de Jobs

### Estrutura de Arquivos

```
src/
├── process/                       ← Execução genérica de processos (separado do job)
│   └── supervisor.ts             ← ProcessSupervisor: spawn, timeout, log, kill-tree
├── jobs/                          ← Orquestração de jobs (fila + persistência)
│   ├── service.ts                ← JobService: fila, estados, delega pro supervisor
│   ├── store.ts                  ← Store em JSON (JobStore)
│   └── tooling.ts                ← Formatação/filtro para exibição
├── video/
│   └── jobs.ts                   ← Validação e comandos ffmpeg/ffprobe/VLC
└── automation/                   ← Camada de monitoramento
    └── heartbeat-runner.ts         ← HeartbeatRunner
```

### JobService (`src/jobs/service.ts`) + ProcessSupervisor (`src/process/supervisor.ts`)

**Responsabilidade:** O `JobService` gerencia a fila, persistência e ciclo de
vida dos jobs. O `ProcessSupervisor` executa o processo em si (spawn, timeout,
logs). A separação permite reusar `ProcessSupervisor` em outros contextos que
não sejam jobs de vídeo.

```typescript
class JobService {
  constructor(store, supervisor, options) {}
  
  // Listagem
  listJobs() → store.list()
  
  // Consulta individual
  getJob(jobId) → store.get(jobId)
  getJobLog(jobId) → lê arquivo de log
  
  // Execução
  enqueue({ capability, action, command, args, ... })
  cancelJob(jobId)
}
```

### JobStore (`src/jobs/store.ts`)

**Responsabilidade:** Persistência de jobs em arquivo JSON.

**Localização:** `dataDir/jobs/jobs.json`

**Estrutura do Arquivo:**
```json
{
  "jobs": {
    "abc-123-def-456": {
      "id": "abc-123-def-456",
      "capability": "video",
      "action": "transcode",
      "status": "queued",
      "sessionKey": "session-1",
      "command": "ffmpeg",
      "input": "/path/to/input.mp4",
      "output": "/path/to/output.mp4",
      "args": ["-y", "-i", ...],
      "logPath": "/path/to/dataDir/jobs/logs/abc-123.log",
      "createdAt": "2026-02-18T20:00:00.000Z",
      "startedAt": "2026-02-18T20:00:01.234Z",
      "endedAt": "2026-02-18T20:00:10.567Z",
      "exitCode": 0,
      "error": null
    },
    "def-789-ghi-012": {
      "id": "def-789-ghi-012",
      "capability": "video",
      "action": "capture_stream",
      "status": "running",
      ...
    }
  }
}
```

**Operações CRUD:**
```typescript
class JobStore {
  constructor(dataDir) {
    this.jobsPath = "dataDir/jobs/jobs.json"
    this.logsDir = "dataDir/jobs/logs"
  }
  
  async init() → carrega jobs do arquivo JSON
  async create(job) → adiciona job no Map e persiste
  async update(jobId, patch) → atualiza job no Map e persiste
  get(jobId) → busca job no Map
  list() → retorna todos os jobs ordenados por createdAt
  getLogPath(jobId) → retorna caminho do arquivo de log
}
```

### JobService + video jobs

**Responsabilidade:** `JobService` gerencia a fila e o ciclo de vida. Os builders
de vídeo apenas validam entradas e montam os comandos ffmpeg/ffprobe/VLC. O
`ProcessSupervisor` cuida da execução do processo em si.

```typescript
class JobService {
  constructor(store, supervisor, options) {}
  
  // Métodos públicos
  enqueue({ capability: "video", action: "transcode", command: "ffmpeg", ... })
  
  // Método privado core
  private async startJob(params) {
    // 1. Cria job com status "queued"
    const job = {
      id: crypto.randomUUID(),
      status: "queued",
      logPath: jobs.getLogPath(jobId),
      ...
    };
    await jobs.create(job);
    
    // 2. Muda para "running" e inicia processo
    await jobs.update(jobId, { status: "running", startedAt });
    const { process } = runner.spawn(command, args);
    
    // 3. Captura stdout/stderr para arquivo de log
    logStream = fs.createWriteStream(job.logPath);
    process.stdout.on("data", chunk => logStream.write(chunk));
    process.stderr.on("data", chunk => logStream.write(chunk));
    
    // 4. Observa erro
    process.on("error", async (error) => {
      await jobs.update(jobId, { status: "failed", error });
      logStream.end(`\n[process-error] ${error.message}\n`);
    });
    
    // 5. Observa finalização
    process.on("close", async (code) => {
      await jobs.update(jobId, {
        status: code === 0 ? "succeeded" : "failed",
        endedAt: new Date().toISOString(),
        exitCode: code
      });
      logStream.end(`\n[process-exit] code=${code}\n`);
    });
  }
}
```

**Logs de Processo:**
```
dataDir/jobs/logs/job-id-1.log
┌─────────────────────────────────────────────────────┐
│ [process-start] 2026-02-18T20:00:01.234Z    │
│ FFmpeg version 6.1.1...                            │
│ Input: /path/to/input.mp4                          │
│ ...                                                │
│ [process-exit] code=0                               │
└─────────────────────────────────────────────────────┘
```

---

## Ciclo de Vida de um Job

### Estados Possíveis

```
┌─────────────────────────────────────────────────────┐
│ queued → running → succeeded (caminho feliz)     │
│   ↓           ↓                                     │
│ queued → running → failed (caminho triste)       │
└─────────────────────────────────────────────────────┘
```

### Fluxo Completo em 5 Passos

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CRIAÇÃO (queued)                              │
│    └─→ JobStore.create(job)                      │
│       └─→ { status: "queued", createdAt }          │
│       └─→ persiste em jobs.json                  │
│                                                     │
│ 2. INÍCIO (running)                                │
│    └─→ JobStore.update(jobId, {                   │
│          status: "running", startedAt })             │
│       └─→ runner.spawn(command, args)              │
│       └─→ cria processo ffmpeg/ffprobe            │
│                                                     │
│ 3. EXECUÇÃO (processo rodando)                       │
│    └─→ stdout/stderr → arquivo de log               │
│       └─→ logs/job-id-1.log                       │
│                                                     │
│ 4. FINALIZAÇÃO (succeeded ou failed)                 │
│    └─→ process.on("close", code)                  │
│       └─→ JobStore.update({                      │
│            status: code===0 ? "succeeded" : "failed", │
│            endedAt, exitCode })                      │
│       └─→ persiste status final em jobs.json         │
│                                                     │
│ 5. CONCLUSÃO                                       │
│    └─→ JobStore.list() pode mostrar o job        │
│       └─→ status final: "succeeded" ou "failed"   │
│       └─→ com log completo em job-id-1.log       │
└─────────────────────────────────────────────────────────────┘
```

### Exemplo de Job no JSON

```json
{
  "id": "abc-123-def-456",
  "capability": "video",
  "action": "transcode",
  "status": "succeeded",
  "sessionKey": "session-1",
  "command": "ffmpeg",
  "input": "/videos/input.mp4",
  "output": "/videos/output.mp4",
  "args": ["-y", "-i", "/videos/input.mp4", "-c:v", "libx264", "/videos/output.mp4"],
  "logPath": "/.kael-data/jobs/logs/abc-123-def-456.log",
  "createdAt": "2026-02-18T20:00:00.000Z",
  "startedAt": "2026-02-18T20:00:01.234Z",
  "endedAt": "2026-02-18T20:00:10.567Z",
  "exitCode": 0,
  "error": null
}
```

---

## Como Funciona o Heartbeat

### Responsabilidade

Monitorar **mudanças de status de jobs** em intervalos regulares e notificar a sessão quando ocorrerem mudanças relevantes.

### HeartbeatRunner (`src/automation/heartbeat-runner.ts`)

**Estado Interno:**
```typescript
class HeartbeatRunner {
  private readonly lastByJobId: Map<string, JobSnapshot> = new Map();
  private seeded = false;
}

type JobSnapshot = {
  status: string;
  capability: string;
  action: string;
  sessionKey: string;
  output?: string;
};
```

**O que é "Relevante"?**
```typescript
function isRelevantStatus(status: string): boolean {
  // Apenas SUCESSO ou FALHA são relevantes
  return status === "succeeded" || status === "failed";
}
```

**Eventos NÃO relevantes (ignorados):**
- `queued` → `queued` (ainda nem começou)
- `queued` → `running` (só iniciou, não mudou status)
- `failed` → `failed` (mesmo status)

### Fluxo de Execução

```
┌─────────────────────────────────────────────────────────────┐
│ 1. SEED (Inicialização)                            │
│    └─→ heartbeat.runOnce() é chamado                   │
│       └─→ para cada job, cria snapshot inicial       │
│       └─→ lastByJobId.set(jobId, {               │
│              status, capability, action, sessionKey, output }) │
│                                                     │
│ 2. CHECAGEM PERIÓDICA (via Scheduler)                │
│    └─→ Scheduler roda heartbeat.runOnce() em intervalo     │
│       └─→ jobs.listJobs() busca todos os jobs        │
│       └─→ compara snapshot anterior com estado atual    │
│                                                     │
│ 3. DETECÇÃO DE MUDANÇA                           │
│    └─→ para cada job:                                 │
│       └─→ current = estado atual do job           │
│       └─→ previous = snapshot do passo 1           │
│       └─→ SE não mudou OU status não relevante:  │
│          └─→ continue (ignora)                  │
│       └─→ SE mudou E status é relevante:            │
│          └─→ notifica sessão                        │
│                                                     │
│ 4. NOTIFICAÇÃO                                     │
│    └─→ sessions.appendMessage(sessionKey, "system",   │
│       `[heartbeat] job ${id} (${capability}/${action}) mudou │
│        ${prev} -> ${curr}. output=${output}`)      │
└─────────────────────────────────────────────────────────────┘
```

### Exemplo de Notificação

**Mudança Relevante (Sucedido):**
```
[heartbeat] job abc-123 (video/transcode) mudou running -> succeeded. output=/videos/output.mp4
```

**Mudança Relevante (Falha):**
```
[heartbeat] job def-456 (video/capture_stream) mudou running -> failed. exit code=1
```

**Mudança NÃO Relevante (Ignorada):**
```
[heartbeat] job xyz-789 (video/probe_media) mudou queued -> running.
← não notifica (running não é status relevante)
```

---

## Exemplos de Fluxo Completo

### Exemplo 1: Job de Transcode Completo

```
Usuário: /transcode /input/video.mp4 /output/result.mp4
         ↓
ChatService → videoJobs.startTranscode(...)
         ↓
JobService → cria job (queued)
         ↓
JobService → job aparece em listJobs()
         ↓
[30s depois] Heartbeat roda (primeira vez, seed)
         ↓
[Heartbeat] Ignora: queued → queued (não é relevante)
         ↓
[30s depois] Job muda para running
         ↓
[30s depois] Heartbeat roda
         ↓
[Heartbeat] Ignora: queued → running (não é relevante)
         ↓
... (ffmpeg processando por 45 segundos) ...
         ↓
[30s depois] Job muda para succeeded
         ↓
[30s depois] Heartbeat roda
         ↓
[Heartbeat] NOTIFICA! running → succeeded
         ↓
Sessão recebe: "[heartbeat] job abc-123 (video/transcode) mudou running -> succeeded. output=/output/result.mp4"
```

### Exemplo 2: Job com Falha

```
Usuário: /hls /input/broken.mp4 /playlist.m3u8
         ↓
ChatService → videoJobs.startConvertHls(...)
         ↓
ProcessJobService → cria job (queued)
         ↓
[30s depois] Heartbeat roda (seed)
         ↓
[30s depois] Job muda para running
         ↓
[15s depois] ffmpeg falha (exit code 1)
         ↓
Job muda para failed
         ↓
[15s depois] Heartbeat roda
         ↓
[Heartbeat] NOTIFICA! running → failed
         ↓
Sessão recebe: "[heartbeat] job def-456 (video/convert_hls) mudou running -> failed. exit code=1"
```

### Exemplo 3: Múltiplos Jobs Rodando

```
┌─────────────────────────────────────────────────────┐
│ T0: Usuário inicia job1 (transcode)           │
│ T1: Usuário inicia job2 (capture_stream)       │
│ T2: Usuário inicia job3 (probe_media)         │
│                                                     │
│ [Heartbeat T3]:                               │
│   - job1: queued → running (ignora)             │
│   - job2: queued → running (ignora)             │
│   - job3: queued → running (ignora)             │
│                                                     │
│ [Heartbeat T4]:                               │
│   - job1: running → succeeded ✅ (NOTIFICA!)      │
│   - job2: running → running (ignora)             │
│   - job3: running → running (ignora)             │
│                                                     │
│ [Heartbeat T5]:                               │
│   - job1: succeeded → succeeded (ignora)        │
│   - job2: running → failed ❌ (NOTIFICA!)        │
│   - job3: running → running (ignora)             │
│                                                     │
│ [Heartbeat T6]:                               │
│   - job2: failed → failed (ignora)              │
│   - job3: running → succeeded ✅ (NOTIFICA!)      │
│                                                     │
│ Sessão (apenas eventos relevantes):               │
│   [heartbeat] job1 (video/transcode) mudou running -> succeeded... │
│   [heartbeat] job2 (video/capture_stream) mudou running -> failed... │
│   [heartbeat] job3 (video/probe_media) mudou running -> succeeded... │
└─────────────────────────────────────────────────────┘
```

---

## Configuração

### Variáveis de Ambiente

```bash
# Heartbeat
KAEL_HEARTBEAT_ENABLED=true           # Habilita heartbeat (default: true)
KAEL_HEARTBEAT_INTERVAL_MS=30000   # Intervalo de execução (default: 30s)

# Scheduler
KAEL_SCHEDULER_TICK_MS=1000          # Tick do scheduler (default: 1s)
```

### Global Config (`~/.kael/config.json`)

```json
{
  "version": 1,
  "defaults": {
    "automation": {
      "heartbeatEnabled": true,
      "heartbeatIntervalMs": 30000,
      "schedulerTickMs": 1000
    }
  }
}
```

### Arquivo de Scheduler

**Localização:** `dataDir/automation/scheduler-jobs.json`

```json
{
  "jobs": {
    "heartbeat.main": {
      "id": "heartbeat.main",
      "type": "heartbeat",
      "enabled": true,
      "intervalMs": 30000,
      "nextRunAt": "2026-02-18T20:30:00.000Z",
      "lastRunAt": "2026-02-18T20:00:00.000Z"
    }
  }
}
```

---

## Interação com Outros Componentes

### JobStore + Heartbeat

```typescript
// HeartbeatRunner
async runOnce(): Promise<{ notifiedCount: number }> {
  const allJobs = this.jobs.listJobs(); // ← Chama JobService.listJobs()
                                          // ← Chama JobStore.list()
  for (const job of allJobs) {
    // Cria snapshot inicial
    this.lastByJobId.set(job.id, {
      status: job.status,
      capability: job.capability,
      action: job.action,
      sessionKey: job.sessionKey,
      output: job.output,
    });
  }
  return { notifiedCount: 0 };
}
```

### ProcessJobService + JobStore

```typescript
private async startJob(params): Promise<VideoJob> {
  const jobId = crypto.randomUUID();
  const initial = { id: jobId, status: "queued", ... };
  
  await this.jobs.create(initial);      // ← JobStore.create()
  await this.jobs.update(jobId, {     // ← JobStore.update()
    status: "running",
    startedAt: new Date().toISOString(),
  });
  
  const { process } = this.runner.spawn(command, args);
  process.on("close", async (code) => {
    await this.jobs.update(jobId, {   // ← JobStore.update()
      status: code === 0 ? "succeeded" : "failed",
      endedAt: new Date().toISOString(),
    });
  });
}
```

---

## Glossário

| Termo | Significado |
|--------|--------------|
| **Job** | Unidade de trabalho executada por capability (ex.: `video/transcode`) |
| **JobStore** | Persistência JSON de jobs (`jobs.json`) |
| **JobService** | Orquestrador de jobs: fila, persistência, delega execução ao supervisor |
| **ProcessSupervisor** | Executor genérico de processos: spawn, timeout, logs, kill-tree |
| **Video jobs** | Validação e montagem de comandos ffmpeg/ffprobe/VLC |
| **Heartbeat** | Monitorador periódico de mudanças de status |
| **HeartbeatRunner** | Implementação do heartbeat |
| **Snapshot** | Estado anterior de um job armazenado pelo heartbeat |
| **Relevante** | Mudança que deve ser notificada (`succeeded` ou `failed`) |
| **Scheduler** | Agendador que executa o heartbeat em intervalos |
| **PersistentScheduler** | Implementação do scheduler com store JSON |
| **Seeding** | Inicialização do heartbeat com snapshots iniciais |

---

## FAQ

### Q: Por que heartbeat ignora `queued → running`?
**A:** Porque `running` não é um status final. Apenas `succeeded` e `failed` indicam conclusão do trabalho, que são os eventos relevantes para o usuário.

### Q: O heartbeat reinicia jobs?
**A:** Não. O heartbeat apenas **observa** e **notifica** mudanças. Jobs são executados pelo `JobService` (via `ProcessSupervisor`) quando chamados via `ChatService`.

### Q: Onde ficam os logs do ffmpeg?
**A:** Em `dataDir/jobs/logs/job-id.log`. O `JobStore.getLogPath(jobId)` retorna este caminho, e o `ProcessSupervisor` direciona stdout/stderr para esse arquivo.

### Q: Como o scheduler recupera após restart?
**A:** O `PersistentScheduler` carrega o estado de `scheduler-jobs.json` ao iniciar. Se um job tem `nextRunAt` no passado, o scheduler o executa no próximo tick (catch-up básico).

### Q: O heartbeat consome recursos do sistema?
**A:** Não significativamente. O heartbeat roda `jobs.listJobs()` que lê do JSON em memória, não executa ffmpeg. O consumo é proporcional ao número de jobs ativos.

---

## Referências de Código

- `src/jobs/manager.ts` - Facade de jobs
- `src/jobs/store.ts` - Persistência JSON
- `src/video/jobs.ts` - Builders de comandos ffmpeg
- `src/automation/heartbeat-runner.ts` - Monitorador de status
- `src/automation/scheduler/persistent-scheduler.ts` - Agendador
- `src/config.ts` - Configuração de heartbeat/scheduler
- `src/global-config.ts` - Defaults globais
