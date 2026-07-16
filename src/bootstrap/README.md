# Bootstrap

Composição explícita do Kael a partir de fases pequenas. Não há loader automático:
`createKaelApp()` chama cada módulo em ordem e passa as dependências de forma
visível.

## Arquitetura

```
KaelConfig
   |
   v
bootstrap/modules/core.ts
   |-- config
   |-- sessions
   `-- jobs
        |
        v
bootstrap/modules/video.ts
   |-- ffmpeg
   |-- VHS streamer/playback/inspect
   |-- stream monitor
   |-- media artifacts
   `-- serve manager
        |
        +--> bootstrap/modules/services.ts
        |      |-- memory
        |      |-- workspace
        |      |-- research
        |      |-- planner
        |      `-- skills
        |
        +--> bootstrap/modules/agent-core.ts
        |      |-- shell runtime
        |      |-- MCP runtime
        |      |-- edge runtime
        |      `-- browser runtime
        |
        +--> bootstrap/modules/media.ts
        |      |-- media understanding
        |      |-- image generation
        |      `-- video generation
        |
        +--> bootstrap/modules/chat.ts
        |      |-- engine
        |      |-- turn orchestrator
        |      |-- AgentContext
        |      `-- ChatService
        |
        `--> bootstrap/modules/automation.ts
               |-- heartbeat
               |-- scheduler
               `-- email ingress
```

## Módulos

### `core.ts`

Carrega `KaelConfig`, inicializa `SessionStore`, `JobStore` e `JobService`.
`JobService` fica aqui porque é infraestrutura genérica de jobs/processos; vídeo
apenas consome esse serviço para criar os jobs ffmpeg.

### `video.ts`

Monta as capacidades de vídeo: `ffmpeg`, VHS (`inspect`, `stream`, `playback`),
`HlsStreamMonitorService`, `MediaArtifactsService` e `StreamServeManager`.

O módulo expõe um contrato `streamer` estável para o Kael. Quando a versão atual
do VHS usa `loadOrigin`, o adapter preserva `inspectOrigin` como nome interno do
Kael.

### `agent-core.ts`

Monta os runtimes reais, isto é, componentes com execução ativa ou lifecycle:
`shell`, `mcp`, `edge` e `browser`.

### `services.ts`

Monta fachadas de lógica de negócio: `memory`, `workspace`, `research`,
`planner` e `skills`. Também registra os action handlers ffmpeg no planner.

### `media.ts`

Monta os serviços multimodais: compreensão de mídia, geração de imagem e geração
de vídeo/artifacts, com fallback `Noop*` quando a configuração não habilita
provider.

### `chat.ts`

Monta engine, `TurnOrchestrator`, `AgentContext` e `ChatService`. O
`AgentContext` é o objeto de capacidades passado ao engine e às PI tools; ele não
é chamado de runtime porque não gerencia lifecycle por si só. O `KaelApp` expõe
esse contexto em `app.agent`, sem duplicar as mesmas capacidades no topo do app.

O contexto é agrupado por domínio:

- `core`: sessão e orquestração de turnos;
- `runtimes`: shell, MCP, edge e browser;
- `services`: memória, workspace, research, planner, skills e media understanding;
- `video`: jobs, ffmpeg, inspect, streamer, stream monitor, playback e serve manager;
- `generation`: geração de imagem e vídeo.

### `automation.ts`

Monta automação operacional: `HeartbeatRunner`, `PersistentScheduler` e
`EmailIngestService` quando habilitado. Registra jobs periódicos apenas quando
`startAutomation=true`.

## Convenção

- Use `Runtime` somente para componentes que gerenciam execução ativa ou
  lifecycle (`ShellRuntime`, `McpRuntime`, `EdgeRuntime`, `BrowserRuntime`).
- Use `Service` para fachadas de domínio (`MemoryService`, `ResearchService`,
  `PlannerService`, `SkillService`).
- Use `AgentContext` para o objeto de composição entregue ao chat/engine/tools,
  exposto no app como `app.agent`.
- Cada módulo exporta uma função `bootstrapXModule(config, deps)` ou equivalente.
- Dependências entre fases são explícitas nos parâmetros; não há descoberta
  automática nem inversão de controle escondida.
