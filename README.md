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
  - `pi` (LLM via endpoint compatível com chat completions)
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
- `POST /chat`
- `GET /sessions/:sessionKey/messages`
- `POST /jobs/transcode`
- `POST /jobs/hls`
- `POST /jobs/capture`
- `POST /jobs/probe`
- `GET /jobs`
- `GET /jobs/:jobId`
- `GET /jobs/:jobId/log`

## Configuracao por ambiente

- `KAEL_PORT` (default: `3210`)
- `KAEL_HOST` (default: `127.0.0.1`)
- `KAEL_DATA_DIR` (default: `./.kael-data`)
- `KAEL_ENGINE_MODE` (`simple`, `pi`, `hybrid`; default: `simple`)
- `KAEL_PI_API_URL` (default: `https://api.openai.com/v1/chat/completions`)
- `KAEL_PI_API_KEY` (obrigatoria para modo `pi`)
- `KAEL_PI_MODEL` (default: `gpt-4o-mini`)
- `KAEL_PI_TIMEOUT_MS` (default: `45000`)

## Config global (~/.kael)

O comando `init` cria a home global com:

- `~/.kael/config.json`
- `~/.kael/data`
- `~/.kael/logs`

Ordem de prioridade da configuracao:

1. Variaveis de ambiente (`KAEL_*`)
2. Config global (`~/.kael/config.json`)
3. Fallback local do projeto
