# Kael

Super agente para videos e automacao.

## Documentos de orientacao

- `AGENTS.md`: instrucoes principais para qualquer agente.
- `START-HERE.md`: indice rapido de onboarding.
- `PROJECT-STATUS.md`: fases, entregas e checklist por commit.

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
npm run dev
```

Servidor padrao: `http://127.0.0.1:3210`

## Comandos CLI

```bash
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
