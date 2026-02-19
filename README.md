# Kael

Super agente para videos e automacao.

## Documentos de orientacao

- `AGENTS.md`: instrucoes principais para qualquer agente.
- `docs/core/START-HERE.md`: indice rapido de onboarding.
- `docs/planning/PROJECT-STATUS.md`: fases, entregas e checklist por commit.
- `docs/architecture/README.md`: arquitetura incremental por fase.

## Escopo atual

- API HTTP local (Fastify)
- CLI para operar chat e jobs
- Sessao persistente com transcript JSONL
- Engine desacoplada com modos:
  - `simple` (comandos)
  - `pi` (runtime PI embutido via SDK)
  - `hybrid` (slash commands local + conversa via PI com fallback)
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

### Runtime do PI

Kael executa PI embutido via SDK usando dependencias npm:
- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-ai`

Nao ha dependencia do binario `pi` no PATH.

Se no futuro for necessario reintroduzir transportes alternativos (processo local/HTTP), a recomendacao e criar um adapter separado e manter `PiEngineAdapter` principal limpo (SDK-only).

Observacao: Kael agora carrega `.env` automaticamente no bootstrap da app.
Observacao: no modo PI (`pi`/`hybrid`), Kael monta o `system prompt` com `docs/core/SOUL.md` automaticamente (ou `KAEL_SOUL_PATH`, se definido).
Observacao: Kael aplica janela de contexto multi-turn antes de chamar PI (via `TurnOrchestrator`).

## Config global (~/.kael)

O comando `init` cria a home global com:

- `~/.kael/config.json`
- `~/.kael/data`
- `~/.kael/logs`

Ordem de prioridade da configuracao:

1. Variaveis de ambiente (`KAEL_*`)
2. Config global (`~/.kael/config.json`)
3. Fallback local do projeto
