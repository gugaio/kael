# kael

## Summary
Kael é um **super agente local** (Node.js + TypeScript) inspirado no *openclaw*, focado em **vídeo/streaming** e **automação operacional** com runtime real:
- execução de pipelines (ffmpeg/ffprobe/VLC) via **jobs assíncronos**
- **tools** para shell (exec/process), browser (playwright), pesquisa web (evidência) e vídeo (HLS audit/inspect/probe)
- **memória persistente** (Markdown/JSON) e **knowledge base** por projeto
- integrações (Discord, Email) e extensibilidade via **skills** (`.kael/skills`) e **MCP**

## Boundaries
Cobre:
- Core agent runtime (chat, sessão, tools, policies, planner)
- Jobs de vídeo (transcode/HLS/capture/probe) com segurança de paths/args
- Persistência local (jobs/plans/memory/knowledge)
- Integrações: Discord (chat-only), Email ingress/auto-reply (quando habilitado), Edge/Clark (MCP)

Não cobre (por design):
- Player/video UI de produção (a UI aqui é uma console web opcional)
- Render/encode em escala (é um runtime local, não um cluster)

## Key Flows
### App entrypoints
- CLI principal: `src/cli/index.ts`
  - `init`, `server`, `chat`, `jobs`, `schedules`, etc.
- API server: `src/api/server.ts` (ver rotas em `src/api/routes/*`)

### Networking
- HTTP API (Fastify): endpoints em `docs/api.md`
- Realtime:
  - SSE: `GET /events/stream`
  - WS: `/ws` (handshake Edge/Clark)

### Params / contracts
- Jobs: `src/capabilities/video/jobs/job-contracts.ts` (+ `src/jobs/*` core)
- Tools PI specs: `src/engine/tool-specs/*` (schema/validação/execução)

### Playback / vídeo
- Capability de vídeo (jobs + serviços): `src/capabilities/video/*`
- Tools de vídeo (inspect/audit/diff/probe): `src/tools/video/*` e `src/engine/tool-specs/video.ts`

## Important Paths
- `src/cli/` — comandos e entrypoint local
- `src/api/` — server Fastify + rotas
- `src/chat/` — core loop de chat / reply orchestrator
- `src/engine/` — integração com PI runtime + tool-specs
- `src/jobs/` — job manager/store/logs
- `src/capabilities/video/` — domínio de vídeo (ffmpeg/ffprobe/VLC, auditoria HLS)
- `src/tools/` — tools do runtime (video/mcp/system/browser)
- `src/memory/` — memory_search/get/write + persistência
- `src/knowledge/` — knowledge base (notes/search/upsert)
- `src/email/` — ingress/polling + auto-reply (quando habilitado)
- `src/integrations/discord/` — discord bot (chat-only)
- `apps/clark/` — app auxiliar (Clark) para capabilities remotas/MCP
- `ui/` — UI web opcional (Vite)
- `.kael/projects/kael/` — project space (este documento + docs internos do projeto)

## Conventions
- TypeScript strict + ESM (`"type": "module"`)
- Estrutura **feature-first por domínio** (ver `docs/architecture/README.md`)
- Operações “perigosas” passam por **policy/approvals** (especialmente `exec/process`)
- Evitar `src/services` genérico; prefira módulos por domínio

## Open Questions
- Quais são os **objetivos de vídeo** prioritários (ex.: HLS live triage, LL-HLS, DRM, SSAI, QoE)?
- Qual é o “*core loop*” desejado do superagente: **chat-first**, **task-first** (planner), ou **observability-first** (auto triage)?
- Quais integrações são “must-have” (Youbora, X-Ray Player Control, Grafana, etc.) e quais ficam via MCP?
