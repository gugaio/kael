# Kael

Super agente para videos e automacao.

## Documentos de orientacao

- `AGENTS.md`: instrucoes principais para qualquer agente.
- `docs/core/START-HERE.md`: indice rapido de onboarding.
- `docs/planning/PROJECT-STATUS.md`: fases, entregas e checklist por commit.
- `docs/architecture/README.md`: arquitetura incremental por fase.
- `docs/ui/UI-GUIDE.md`: guia oficial da UI (visao, fases, status e proximos passos).
- `docs/how-jobs-and-heartbeat-work.md`: guia detalhado do ciclo de vida de jobs e heartbeat.

## Escopo atual

- API HTTP local (Fastify)
- CLI para operar chat e jobs
- Sessao persistente com transcript JSONL
- Engine desacoplada com modos:
  - `simple` (comandos)
  - `pi` (runtime PI embutido via SDK)
  - `hybrid` (slash commands local + conversa via PI com fallback)
- Shell tools no PI:
  - `exec` (comando shell com timeout/background)
  - `process` (list/poll/kill de sessoes em background)
  - policy e approvals persistidas em `~/.kael/exec-approvals.json`
- Jobs de video assíncronos:
  - `transcode`
  - `convert_hls`
  - `capture_stream`
  - `probe_media`

## Requisitos

- Node.js 22+
- ffmpeg e ffprobe no PATH

## Rodando

```bash
npm install
npm run check
npx tsx src/cli/index.ts init
npm run dev
```

Servidor padrao: `http://127.0.0.1:3210`

## UI Web (UI-1)

```bash
# instalar deps do frontend
npm --prefix ui install

# subir backend (terminal 1)
npm run dev

# subir UI (terminal 2)
npm run ui:dev
```

UI default: `http://127.0.0.1:5173` (proxy para API local em `/api`).

## Comandos CLI

```bash
# inicializar ~/.kael (ou $KAEL_HOME)
npx tsx src/cli/index.ts init

# sobrescrever config global
npx tsx src/cli/index.ts init --force

# iniciar API
npx tsx src/cli/index.ts server

# ajuda de comandos de chat
npx tsx src/cli/index.ts chat --message "/help"

# listar jobs
npx tsx src/cli/index.ts jobs

# cancelar job
npx tsx src/cli/index.ts job-cancel --id <jobId>

# listar schedules
npx tsx src/cli/index.ts schedules

# criar/atualizar schedule por intervalo
npx tsx src/cli/index.ts schedule-upsert --id heartbeat.main --type heartbeat --interval-ms 30000

# criar/atualizar schedule por cron (5 campos)
npx tsx src/cli/index.ts schedule-upsert --id heartbeat.cron --type heartbeat --cron "*/5 * * * *"

# pausar/reativar schedule
npx tsx src/cli/index.ts schedule-pause --id heartbeat.main
npx tsx src/cli/index.ts schedule-resume --id heartbeat.main

# approvals de exec
npx tsx src/cli/index.ts approvals --status open
npx tsx src/cli/index.ts approval-approve --id <approvalId>
npx tsx src/cli/index.ts approval-deny --id <approvalId>
```

## Comandos de chat (engine de comandos)

```text
/transcode <input> <output>
/hls <input> <playlist.m3u8> [segmentSeconds]
/capture <streamUrl> <output> [durationSeconds]
/probe <input>
/jobs
/help
```

## Endpoints

- `GET /health`
- `POST /chat` (opcional: `?includeMessages=true` para incluir objetos `user` e `assistant`)
- `GET /sessions/:sessionKey/messages`
- `POST /jobs/transcode`
- `POST /jobs/hls`
- `POST /jobs/capture`
- `POST /jobs/probe`
- `GET /jobs`
- `GET /jobs/:jobId`
- `GET /jobs/:jobId/log`
- `POST /jobs/:jobId/cancel`
- `GET /exec/approvals`
- `POST /exec/approvals/:approvalId/approve`
- `POST /exec/approvals/:approvalId/deny`
- `GET /schedules`
- `GET /schedules/:scheduleId`
- `POST /schedules`
- `POST /schedules/:scheduleId/pause`
- `POST /schedules/:scheduleId/resume`

### Contrato de erro (padronizado)

Erros da API agora seguem o formato:

```json
{
  "ok": false,
  "error": {
    "status": 400,
    "code": "BAD_REQUEST",
    "message": "message is required",
    "details": null,
    "requestId": "req-1"
  }
}
```

Códigos atuais: `BAD_REQUEST`, `NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `INTERNAL_ERROR`.

### Idempotency (Fase 3)

Para evitar duplicacao em retries de cliente, envie o header `x-idempotency-key` em:

- `POST /chat`
- `POST /jobs/transcode`
- `POST /jobs/hls`
- `POST /jobs/capture`
- `POST /jobs/probe`

Se a mesma chave e mesmo payload forem repetidos dentro do TTL, a API retorna a resposta cacheada com header `x-idempotency-replayed: true`.
Se a mesma chave for reutilizada com payload diferente, a API retorna `409`.

## Configuracao por ambiente

- `KAEL_PORT` (default: `3210`)
- `KAEL_HOST` (default: `127.0.0.1`)
- `KAEL_DATA_DIR` (default: `./.kael-data`)
- `KAEL_ENGINE_MODE` (`simple`, `pi`, `hybrid`; default: `simple`)
- `KAEL_CONTEXT_MAX_MESSAGES` (janela de contexto para engine; default: `24`)
- `KAEL_CONTEXT_MAX_CHARS` (limite de caracteres da janela; default: `12000`)
- `KAEL_PI_PROVIDER` (default: `openai`)
- `KAEL_PI_API_KEY` (opcional; pode ser usado para resolver credencial do provider)
- `KAEL_PI_MODEL` (default: `gpt-4o-mini`)
- `KAEL_PI_TIMEOUT_MS` (default: `45000`)
- `KAEL_PI_RETRY_ATTEMPTS` (default: `3`)
- `KAEL_PI_RETRY_BASE_MS` (default: `300`)
- `KAEL_PI_RETRY_MAX_MS` (default: `3000`)
- `KAEL_PI_RETRY_JITTER_MS` (default: `250`)
- `KAEL_SOUL_PATH` (opcional; caminho explicito para `SOUL.md`)
- `KAEL_IDEMPOTENCY_ENABLED` (default: `true`)
- `KAEL_IDEMPOTENCY_TTL_MS` (default: `600000`)
- `KAEL_HEARTBEAT_ENABLED` (default: `true`)
- `KAEL_HEARTBEAT_INTERVAL_MS` (default: `30000`)
- `KAEL_SCHEDULER_TICK_MS` (default: `1000`)
- `KAEL_SAFE_PATHS_ENABLED` (default: `true`)
- `KAEL_ALLOWED_PATHS` (default: `<cwd>,<dataDir>,/tmp`)
- `KAEL_MAX_JOB_ARGS` (default: `24`)
- `KAEL_MAX_CONCURRENT_JOBS` (default: `2`)
- `KAEL_JOB_TIMEOUT_MS` (default: `3600000`)
- `KAEL_JOB_KILL_GRACE_MS` (default: `3000`)
- `KAEL_EXEC_WORKSPACE_ROOT` (default: `<cwd>`)
- `KAEL_EXEC_TIMEOUT_MS` (default: `60000`)
- `KAEL_EXEC_MAX_TIMEOUT_MS` (default: `900000`)
- `KAEL_EXEC_MAX_OUTPUT_CHARS` (default: `120000`)
- `KAEL_EXEC_APPROVAL_WAIT_MS` (default: `120000`)
- `KAEL_EXEC_SECURITY` (`deny`, `allowlist`, `full`; default: `allowlist`)
- `KAEL_EXEC_ASK` (`off`, `on-miss`, `always`; default: `on-miss`)
- `KAEL_EXEC_ALLOWLIST` (csv; default inclui `ls,cat,pwd,echo,grep,find,curl,ffmpeg,ffprobe,vlc`)

### Runtime do PI

Kael executa PI embutido via SDK usando dependencias npm:
- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-ai`

Nao ha dependencia do binario `pi` no PATH.

Se no futuro for necessario reintroduzir transportes alternativos (processo local/HTTP), a recomendacao e criar um adapter separado e manter `PiEngineAdapter` principal limpo (SDK-only).

Observacao: Kael agora carrega `.env` automaticamente no bootstrap da app.
Observacao: no modo PI (`pi`/`hybrid`), Kael monta o `system prompt` com `docs/core/SOUL.md` automaticamente (ou `KAEL_SOUL_PATH`, se definido).
Observacao: Kael aplica janela de contexto multi-turn antes de chamar PI (via `TurnOrchestrator`).
Observacao: scheduler suporta `intervalMs` e cron expression simples (5 campos, com `*`, `*/n` e valores exatos).
Observacao: `KAEL_ENGINE_MODE=pi|hybrid` exige `KAEL_PI_API_KEY`; configuracoes invalidas falham no startup com mensagem clara.
Observacao: comandos shell fora da allowlist podem retornar `approval-pending`; o arquivo de controle fica em `~/.kael/exec-approvals.json`.

## Logs e observabilidade

- Logs em JSON no `stdout`.
- Eventos HTTP incluem `requestId`, rota, status e duracao.
- Eventos de scheduler incluem `scheduleId`, tipo, `durationMs` e status de execucao.
- `GET /health` inclui `uptimeSec` e metricas agregadas de sessoes/jobs/schedules.
- `GET /health` inclui `metrics.runtimeJobs` (`activeJobs`, `queuedJobs`, `maxConcurrentJobs`).

## Seguranca de execucao (jobs)

- Validacao de input/output path antes de spawn.
- Bloqueio de paths fora das roots permitidas (quando `KAEL_SAFE_PATHS_ENABLED=true`).
- Validacao de stream URL (`http`, `https`, `rtsp`, `rtmp`, `udp`).
- Limite de args custom e bloqueio de flags criticas em args de usuario (`-i`, `-y`).
- Controle de concorrencia por fila interna (`KAEL_MAX_CONCURRENT_JOBS`).
- Timeout por job com cancelamento controlado (`SIGTERM` seguido de `SIGKILL` apos grace period, se necessario).

## Cobertura de testes E2E (jobs)

- `src/api/jobs.e2e.test.ts` cobre:
  - validacao de seguranca (path fora da allowlist)
  - timeout com falha e log de timeout
  - cancelamento de job queued e running via API

## Config global (~/.kael)

O comando `init` cria a home global com:

- `~/.kael/config.json`
- `~/.kael/data`
- `~/.kael/logs`

Ordem de prioridade da configuracao:

1. Variaveis de ambiente (`KAEL_*`)
2. Config global (`~/.kael/config.json`)
3. Fallback local do projeto
