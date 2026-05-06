# Diagrama de Componentes - Detalhado (Nível 2)

Este diagrama mostra os componentes de domínio do Kael em detalhe, incluindo contratos, serviços e suas interações.

## Arquitetura de Domínio

```mermaid
graph TB
    subgraph "Entry Points"
        ChatSvc[ChatService<br/>src/chat/service.ts]
        AutoSvc[AutomationService<br/>src/automation/service.ts]
    end

    subgraph "Engine Layer"
        subgraph "Engine Contract"
            AgentEngine[<<interface>><br/>AgentEngine<br/>runTurn()<br/>getRuntimeTelemetrySnapshot()]
        end

        subgraph "Implementations"
            SimpleEngine[SimpleCommandEngine<br/>src/agents/simple-engine.ts<br/>Comandos locais determinísticos]
            PiEngine[PiEngineAdapter<br/>src/agents/pi-engine-adapter.ts<br/>PI SDK embedded + PiTools]
            HybridEngine[HybridEngine<br/>src/agents/hybrid-engine.ts<br/>Simple + PI com fallback]
        end
    end

    subgraph "Tooling Layer"
        subgraph "Engine Tooling Namespaces"
            Tooling[<<interface>><br/>EngineToolingNamespaces<br/>video.*<br/>jobs.*<br/>system.*<br/>mcp.*<br/>edge.*<br/>memory.*<br/>workspace.*<br/>web.*<br/>browser.*<br/>image.*<br/>plans.*]
        end

        subgraph "Video Tools"
            VideoJob[VideoJobService<br/>src/capabilities/video/job-service.ts<br/>Execução assíncrona de ffmpeg/ffprobe]
            VideoInspect[VideoInspectToolService<br/>src/capabilities/video/inspect-service.ts<br/>Inspeção de HLS e streams]
        end

        subgraph "Shell Tools"
            Shell[ShellToolService<br/>src/tools/system/shell-tool-service.ts<br/>exec/process com approvals]
            Supervisor[ShellProcessSupervisor<br/>src/tools/system/shell-process-supervisor.ts<br/>Lifecycle de processos]
            Approvals[ExecApprovalStore<br/>src/tools/system/shell-approvals.ts<br/>Policy: deny/allowlist/full]
        end

        subgraph "Memory Tools"
            Mem[MemoryService<br/>src/memory/service.ts<br/>search/get/write]
            MemOrch[MemoryOrchestrator<br/>src/memory/orchestrator.ts<br/>flush/compact/promote]
        end

        subgraph "Planner Tools"
            Planner[PlannerService<br/>src/planner/service.ts<br/>create/generate/list/update/execute/reconcile]
            LlmGen[LlmPlanGenerator<br/>src/planner/llm-generator.ts<br/>Geração de planos via LLM]
        end

        subgraph "Research Tools"
            Research[ResearchService<br/>src/research/service.ts<br/>search/fetch/research + ranking + SSRF guard]
        end

        subgraph "Workspace Tools"
            Workspace[WorkspaceInspector<br/>src/workspace/inspector.ts<br/>search/read de workspace]
        end

        subgraph "Browser Tools"
            Browser[BrowserRuntimeService<br/>src/runtime/browser/service.ts<br/>Comandos de navegador]
        end

        subgraph "Image Generation"
            ImgGen[ImageGeneratorService<br/>src/media/image-generator.ts<br/>OpenAI image generation]
        end
    end

    subgraph "Multimodal Pipeline"
        Media[MediaUnderstandingService<br/>src/media/service.ts<br/>vision (image) + transcription (audio)]
        OpenAIVision[OpenAiMediaUnderstandingService<br/>GPT-4o vision/audio]
        NoopMedia[NoopMediaUnderstandingService<br/>Fallback seguro]
    end

    subgraph "Email Pipeline"
        EmailIngest[EmailIngestService<br/>src/email/ingest-service.ts<br/>Ingest + dedupe + reply]
        GmailPop3[GmailPop3Provider<br/>src/email/gmail-pop3-provider.ts<br/>Polling POP3 + parse MIME]
        GmailSmtp[GmailSmtpSender<br/>src/email/gmail-smtp-sender.ts<br/>Auto-reply SMTP]
        EmailDedupe[FileEmailIngestDedupeStore<br/>src/email/ingest-dedupe-store.ts<br/>Dedupe persistente]
    end

    subgraph "Turn Orchestration"
        TurnOrch[TurnOrchestrator<br/>src/chat/turn-orchestrator.ts<br/>Gestão de contexto + engine turn]
        CmdRouter[CommandRouter<br/>src/chat/command-router.ts<br/>Fast-path de slash commands]
        RouteTel[ChatRoutingTelemetry<br/>src/chat/routing-telemetry.ts<br/>Métricas de roteamento]
    end

    subgraph "Automation"
        Scheduler[PersistentScheduler<br/>src/automation/scheduler/persistent-scheduler.ts<br/>Interval/Cron + catch-up]
        Heartbeat[HeartbeatRunner<br/>src/automation/heartbeat-runner.ts<br/>Verificações proativas]
    end

    subgraph "Storage"
        Session[SessionStore<br/>src/session/store.ts]
        JobStore[JobStore<br/>src/jobs/store.ts]
        PlanStore[Planner Store<br/>Plans persistidos]
        MemStore[Memory Store<br/>MEMORY.md + daily]
        ResearchCache[Research Cache<br/>fetch-cache.json]
        EmailState[Email State<br/>gmail-pop3-state.json]
        SchedulerState[Scheduler State<br/>scheduler-jobs.json]
    end

    subgraph "Providers Externos"
        PiSDK[PI Agent SDK]
        OpenAI[OpenAI API<br/>GPT-4o]
        Tavily[Tavily Search API]
        Gmail[Gmail<br/>POP3 + SMTP]
    end

    %% Entry Points to Turn Orchestration
    ChatSvc -->|route messages| CmdRouter
    ChatSvc -->|turn orchestration| TurnOrch
    AutoSvc -->|heartbeat| Heartbeat
    AutoSvc -->|scheduler| Scheduler

    %% Turn Orchestration to Engine
    TurnOrch -->|engine turn| AgentEngine

    %% Engine Implementations
    AgentEngine <|.. SimpleEngine
    AgentEngine <|.. PiEngine
    AgentEngine <|.. HybridEngine

    %% Engine to Tooling
    PiEngine -->|tool calls| Tooling

    %% Tooling to Video
    Tooling -.->|startTranscode/startConvertHls/startCaptureStream/startProbeMedia/startPlayVLC| VideoJob
    Tooling -.->|videoHlsInspect/videoProbe| VideoInspect
    VideoJob -->|persist| JobStore

    %% Tooling to Shell
    Tooling -.->|execCommand/processCommand| Shell
    Shell -->|lifecycle management| Supervisor
    Shell -->|approvals/policy| Approvals

    %% Tooling to Memory
    Tooling -.->|memorySearch/memoryGet/memoryWrite| Mem

    %% Tooling to Planner
    Tooling -.->|planCreate/planGenerate/planList/planUpdateStep/planNextAction/planExecuteNext/planReconcile| Planner
    Planner -->|llm generation| LlmGen
    Planner -->|persist/load| PlanStore

    %% Tooling to Research
    Tooling -.->|webSearch/webFetch/webResearch| Research
    Research -->|cache| ResearchCache

    %% Tooling to Workspace
    Tooling -.->|workspaceSearch/workspaceRead| Workspace

    %% Tooling to Browser
    Tooling -.->|browserCommand/browserRuntimeTelemetry| Browser

    %% Tooling to Image Generation
    Tooling -.->|imageGenerate| ImgGen

    %% ChatService to Multimodal
    ChatSvc -->|pre-process attachments| Media
    Media <|.. OpenAIVision
    Media <|.. NoopMedia
    Media -->|vision/audio| OpenAI

    %% ChatService to Email
    ChatSvc -->|ingest email messages| EmailIngest
    EmailIngest -->|fetch/parse| GmailPop3
    EmailIngest -->|auto-reply| GmailSmtp
    EmailIngest -->|dedupe| EmailDedupe
    GmailPop3 -->|fetch/reply| Gmail
    GmailSmtp -->|send reply| Gmail

    %% ChatService to Storage
    TurnOrch -->|persist/read| Session
    Mem -->|write/read| MemStore

    %% Automation Jobs
    Scheduler -->|heartbeat job| Heartbeat
    Scheduler -->|planner_reconcile job| Planner
    Scheduler -->|email_poll job| EmailIngest
    Scheduler -->|persist/load| SchedulerState

    %% External Dependencies
    PiEngine -->|PI runtime| PiSDK
    OpenAIVision -->|vision/audio| OpenAI
    ImgGen -->|generation| OpenAI
    Research -->|search| Tavily

    %% Styling
    classDef interface fill:#fff9c4,stroke:#f57f17,stroke-width:2px,stroke-dasharray: 5 5
    classDef entry fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef engine fill:#ffe0b2,stroke:#e65100,stroke-width:2px
    classDef tooling fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef pipeline fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef orchestrator fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef automation fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef storage fill:#cfd8dc,stroke:#37474f,stroke-width:2px
    classDef external fill:#f5f5f5,stroke:#616161,stroke-width:1px

    class AgentEngine,Tooling interface
    class ChatSvc,AutoSvc entry
    class SimpleEngine,PiEngine,HybridEngine engine
    class VideoJob,VideoInspect,Shell,Supervisor,Approvals,Mem,MemOrch,Planner,LlmGen,Research,Workspace,Browser,ImgGen tooling
    class Media,EmailIngest,GmailPop3,GmailSmtp,EmailDedupe pipeline
    class TurnOrch,CmdRouter,RouteTel orchestrator
    class Scheduler,Heartbeat automation
    class Session,JobStore,PlanStore,MemStore,ResearchCache,EmailState,SchedulerState storage
    class PiSDK,OpenAI,Tavily,Gmail external
```

## Contratos Principais

### AgentEngine (Interface)
```typescript
interface AgentEngine {
  runTurn(input: EngineTurnInput): Promise<EngineTurnOutput>;
  getRuntimeTelemetrySnapshot?(): EngineRuntimeTelemetry;
}
```

**Implementações:**
- **SimpleCommandEngine**: Comandos locais determinísticos (slash commands básicos).
- **PiEngineAdapter**: Runtime PI Agent SDK embedded com system prompt montado via `SOUL.md`.
- **HybridEngine**: Slash commands locais + conversa via PI com fallback para Simple.

### EngineToolingNamespaces (Interface)
Contrato modular por namespace para todas as tools disponíveis ao engine.

**video:**
- `startTranscode`, `startConvertHls`, `startCaptureStream`, `startProbeMedia`, `startPlayVLC`
- `videoHlsInspect`, `videoProbe`
- `videoGenerateImage`, `playbackAnalyze`

**jobs:**
- `listJobs`, `getJob`, `getJobLog`

**system:**
- `execCommand`: Executar comandos shell com timeout, background, approvals
- `processCommand`: Gerenciar sessões (list/poll/kill/log/remove)

**memory:**
- `memorySearch`: Buscar na memória
- `memoryGet`: Ler arquivo de memória
- `memoryWrite`: Escrever na memória (daily ou long_term)

**workspace:**
- `workspaceSearch`: Buscar no workspace
- `workspaceRead`: Ler arquivo do workspace

**web:**
- `webSearch`: Buscar web via Tavily
- `webFetch`: Fetch URL com extração de texto e cache
- `webResearch`: Pipeline completo (search + fetch + síntese)

**browser:**
- `browserCommand`: Navegar/clicar/scroll/tirar screenshot
- `browserRuntimeTelemetry`: Métricas de runtime

**image:**
- `imageGenerate`: Gerar imagem via OpenAI

**plans:**
- `planCreate`: Criar plano manual
- `planGenerate`: Gerar plano via LLM
- `planList`: Listar planos
- `planUpdateStep`: Atualizar step
- `planNextAction`: Próxima ação do plano
- `planExecuteNext`: Executar próximo step
- `planReconcile`: Reconciliar status com runtime

**mcp / edge:**
- `mcpList`, `mcpCall`
- `edgeList`, `edgeCall`, `youboraMetricsGet`, `youboraRawdataGet`, `youboraEventsGet`

### EmailProvider (Interface)
Provider plugável para ingest de email:
- **GmailPop3Provider**: Polling POP3 com parse MIME e estado de UIDs.
- **GmailPubSubProvider** (futuro): Push via Gmail Pub/Sub API.

### ShellRuntime (Interface)
Abstração para execução de shell com approvals:
- `exec`: Executar comando
- `process`: Gerenciar sessões

### MediaUnderstandingService (Interface)
Entendimento multimodal plugável:
- **OpenAiMediaUnderstandingService**: GPT-4o vision/audio.
- **NoopMediaUnderstandingService**: Fallback seguro sem custo.

## Services de Domínio

### VideoJobService
Execução assíncrona de jobs de vídeo (ffmpeg/ffprobe) com:
- Job assíncrono com timeout e graceful shutdown
- Logs dedicados por job
- Segurança por safe paths e allowed paths
- Limite de jobs concorrentes
- Status: queued → running → succeeded/failed/canceled

### ShellToolService
Execução segura de comandos shell com:
- Timeout total e timeout por ausência de output
- Sessões em background com polling
- Policy de segurança: deny/allowlist/full
- Approvals: ask=off|on-miss|always
- Failure codes padronizados: syntax_error, allowlist_miss, timeout_overall, timeout_no_output, signal, non_zero_exit

### MemoryService
Memória persistente com:
- **Long-term**: `MEMORY.md` (curado, human-readable)
- **Daily**: `memory/YYYY-MM-DD.md` (bruto, append-only)
- Retrieval híbrido (textual + semântico)
- Dedupe textual e semântico
- Policy de escrita (paths permitidos)

### PlannerService
Planejamento multi-etapa com:
- Planos persistidos em JSON
- Steps com status (pending/in_progress/completed/blocked/failed/canceled)
- Geração via LLM com checkpoints
- Executor assistido com vínculo a jobs/exec
- Reconciliação automática com runtime

### ResearchService
Pesquisa web com:
- Provider plugável (Tavily)
- Cache por URL com TTL
- SSRF guard (bloqueio de localhost/faixas privadas)
- Ranking de evidência por relevância/fonte/recência
- Sumarização multi-fonte com score de confiança
- Memória de pesquisas por sessão

### MediaUnderstandingService
Entendimento multimodal com:
- **Vision**: Descrição de imagem via GPT-4o
- **Audio**: Transcrição via OpenAI Whisper
- Budget por origem (api/discord/email)
- Limite de bytes por mensagem
- Deadline de processamento por turno

### EmailIngestService
Ingest de email com:
- Provider desacoplado (Gmail POP3 hoje)
- Dedupe por provider:id (persistente)
- Lock de execução (pollInFlight) para evitar overlap
- Parse MIME para extrair corpo + anexos
- Auto-reply SMTP opcional
- Guard de concorrência

## Turn Orchestrator

**Responsabilidades:**
- Gestão de contexto (maxMessages, maxChars)
- Engine turn execution
- Compressão de contexto (auto-compaction)
- Propagação de attachments multimodais

**Componentes:**
- **CommandRouter**: Fast-path de slash commands
- **ChatRoutingTelemetry**: Métricas de roteamento (fast_path vs llm_turn)

## Automation

**PersistentScheduler:**
- Jobs persistidos em JSON com catch-up após restart
- Suporte a intervalo e cron
- Tick configurável (default 30s)

**Jobs disponíveis:**
- `heartbeat.main`: Verificações proativas
- `planner.reconcile`: Reconciliação de planos com runtime
- `email_poll`: Polling de emails

## Documentação Relacionada

- [Visão Geral de Componentes (Nível 1)](overview-components.md)
- [Sequência de Chat Principal](sequence-chat-flow.md)
- [Fases do Projeto](../phases/)
