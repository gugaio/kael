# Kael

Super agente para videos e automacao.

## Documentos de orientacao

- `START-HERE.md`: onboarding rapido para qualquer novo agente/Codex.
- `PROJECT-STATUS.md`: fases, entregas realizadas e proximos passos.

## Escopo atual (bootstrap)

- API HTTP local (Fastify)
- CLI para operar chat e jobs
- Sessao persistente com transcript JSONL
- Engine com interface desacoplada (`AgentEngine`)
- Job assíncrono de transcode via ffmpeg

## Requisitos

- Node.js 22+
- ffmpeg no PATH

## Rodando

```bash
npm install
npm run dev
```

Servidor padrão: `http://127.0.0.1:3210`

## CLI

```bash
# iniciar API
npx tsx src/cli/index.ts server

# enviar mensagem para o engine
npx tsx src/cli/index.ts chat --message "/help"

# iniciar transcode
npx tsx src/cli/index.ts chat --message "/transcode ./in.mp4 ./out.mp4"

# listar jobs
npx tsx src/cli/index.ts jobs
```

## Persistência

Por padrão os dados ficam em `./.kael-data` (workspace-local).

Para sobrescrever:

```bash
KAEL_DATA_DIR=/caminho/custom npx tsx src/cli/index.ts server
```
