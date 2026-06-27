# Kael

Kael e um super agente local para **vídeo, automação e execução confiável de pipelines**.

Projeto focado em runtime real: jobs assincronos, ferramentas operacionais, memória persistente, pesquisa web com evidências e integração de canais como Discord e Email.

## Detalhes sobre o projeto

- **Runtime local de verdade**: nao e apenas chat; executa comandos, processos e jobs.
- **Pipeline de video operacional**: transcode, HLS, capture e probe com controle de seguranca.
- **Memória útil no dia a dia**: `memory_search`, `memory_get`, `memory_write` com persistencia local.
- **Pesquisa web orientada a evidência**: `web_search`, `web_fetch`, `web_research`.
- **Arquitetura evolutiva por fases**: documentacao e status de projeto atualizados continuamente.

## Stack

- Node.js + TypeScript strict
- Fastify (API)
- PI runtime (SDK) para modo agentico
- Persistencia local em JSON/JSONL/Markdown

## Quick Start (2 Minutos)

### 1) Requisitos

- Node.js 22+
- `ffmpeg` e `ffprobe` no `PATH`

### 2) Instalar e validar

```bash
npm install
npm run check
```

### 3) Inicializar ambiente global

```bash
./bin/kael init
```

### 4) Subir API local

```bash
npm run dev
```

API padrao: `http://127.0.0.1:3210`

## UI Web (Opcional)

```bash
npm --prefix ui install
npm --prefix ui run dev
```

UI padrao: `http://127.0.0.1:5173` (proxy `/api` -> backend local)

## Discord Bot (Chat-Only)

```bash
npx tsx src/cli/index.ts discord-bot
```

Variaveis principais:

- `DISCORD_BOT_TOKEN`
- `DISCORD_MENTION_ONLY_IN_GUILDS`
- `DISCORD_ALLOWED_GUILD_IDS`
- `DISCORD_ALLOWED_CHANNEL_IDS`
- `DISCORD_SESSION_SCOPE`

Nota: o comando `discord-bot` roda em modo chat-only, sem scheduler/email polling, para evitar duplicacao quando a API ja estiver rodando.

## Principais Capacidades

### Video

- `transcode`
- `convert_hls`
- `capture_stream`
- `probe_media`

### Shell no modo PI

- `exec` (timeout, background, approvals)
- `process` (list/poll/kill/remove)

### Memoria

- `memory_search`
- `memory_get`
- `memory_write`

Persistencia:

- `MEMORY.md` (longo prazo)
- `memory/YYYY-MM-DD.md` (diaria)

### Pesquisa Web

- `web_search`
- `web_fetch`
- `web_research`

### Browser Control (teste de sites)

- `browser` tool no runtime PI
- acoes: `start/open/navigate/snapshot_text/screenshot/click/type/press/wait_for/close`
- telemetria no `/health` em `metrics.browserRuntime`
- atalhos slash no chat: `/browser-*` (fast-path deterministico)

### Planejamento Operacional

- `plan_create`
- `plan_generate`
- `plan_list`
- `plan_update_step`
- `plan_next`
- `plan_execute_next`
- `plan_reconcile`

### Skills (`.kael/skills`)

- suporte a skills locais por arquivo `SKILL.md`
- invocacao manual por slash: `/<skill-name> [args]`
- auto-invocacao conservadora (ate 1 skill por turno)
- telemetria em `/health` -> `metrics.skillsRuntime`

## Comandos CLI Mais Usados

Use `./bin/kael` durante desenvolvimento. Se quiser o comando global `kael`,
rode `npm link` uma vez na raiz do repo.

```bash
# iniciar API
./bin/kael server

# chat
./bin/kael chat --message "/help"

# jobs
./bin/kael jobs
./bin/kael job-cancel --id <jobId>

# schedules
./bin/kael schedules
./bin/kael schedule-upsert --id heartbeat.main --type heartbeat --interval-ms 30000
./bin/kael schedule-pause --id heartbeat.main
./bin/kael schedule-resume --id heartbeat.main

# approvals de exec
./bin/kael approvals --status open
./bin/kael approval-approve --id <approvalId>
./bin/kael approval-deny --id <approvalId>

# smoke browser runtime (playwright real)
npm run test:smoke:browser
```

## Endpoints Principais

- `GET /health`
- `POST /chat`
- `GET /sessions/:sessionKey/messages`
- `GET /jobs`
- `GET /jobs/:jobId`
- `GET /jobs/:jobId/log`
- `POST /jobs/:jobId/cancel`
- `GET /plans`
- `GET /plans/:planId`
- `POST /plans`
- `POST /plans/generate`
- `POST /plans/:planId/execute-next`
- `POST /plans/:planId/cancel`
- `POST /plans/reconcile`
- `GET /schedules`
- `POST /schedules`
- `POST /schedules/:scheduleId/pause`
- `POST /schedules/:scheduleId/resume`

Referencia completa: `docs/api.md`

## Configuracao Essencial (ENV)

- `KAEL_PORT` (default `3210`)
- `KAEL_HOST` (default `127.0.0.1`)
- `KAEL_DATA_DIR` (default `./.kael-data`)
- `KAEL_API_AUTH_TOKEN` (quando definido, exige `Authorization: Bearer <token>` em toda a API)
- `KAEL_ENGINE_MODE` (`simple`, `pi`, `hybrid`)
- `KAEL_PI_API_KEY` (obrigatoria em `pi|hybrid`)
- `KAEL_PI_MODEL` (default `gpt-4o-mini`)
- `KAEL_RESEARCH_ENABLED` (`true|false`)
- `KAEL_RESEARCH_API_KEY` (obrigatoria quando research habilitado)
- `KAEL_EMAIL_ENABLED` (`true|false`)
- `KAEL_EMAIL_AUTO_REPLY_ENABLED` (`true|false`)
- `KAEL_BROWSER_ENABLED` (`true|false`)
- `KAEL_BROWSER_HEADLESS` (`true|false`)
- `KAEL_BROWSER_SESSION_TTL_MS`
- `KAEL_BROWSER_MAX_SESSIONS`
- `KAEL_SKILLS_CATALOG_MAX_CHARS`
- `KAEL_SKILLS_AUTO_MIN_SCORE`
- `KAEL_SKILLS_AUTO_MAX_PER_TURN`
- `KAEL_SKILLS_SESSION_STATS_LIMIT`

## Qualidade e Seguranca

- TypeScript strict
- Guardrails de loop de tool calling
- Idempotency para endpoints criticos
- Logs estruturados JSON
- Politica de execucao shell com allowlist + approvals

## Documentacao Importante

- `AGENTS.md` (instrucao principal para agentes)
- `docs/core/START-HERE.md` (onboarding rapido)
- `docs/core/SOUL.md` (identidade/comportamento)
- `docs/planning/PROJECT-STATUS.md` (status por fase + historico)
- `docs/architecture/README.md` (arquitetura por fases)
- `docs/how-jobs-and-heartbeat-work.md`
- `docs/skills.md` (guia de criacao e operacao de skills em `.kael/skills`)
- `docs/browser-control.md` (guia de browser control via CLI/chat)
- `docs/ui/UI-GUIDE.md`
- `docs/deployment-docker.md` (deploy inicial em VPS com Docker)

## Roadmap Atual

Fase ativa: **Fase 16 (Browser Control para teste de sites)**.

Para detalhes de progresso e proximos passos:

- `docs/planning/PROJECT-STATUS.md`

---

Se quiser contribuir, abra issue/PR com foco em mudancas pequenas, verificaveis e alinhadas com a arquitetura por fases.
