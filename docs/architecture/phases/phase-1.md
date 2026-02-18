# Arquitetura - Fase 1 (Core Loop)

Status: historico concluido

## Objetivo

Estabelecer um loop minimo funcional: receber mensagem, persistir sessao, disparar acao basica e responder.

## Componentes

- CLI (`src/cli/index.ts`)
- API Fastify (`src/api/server.ts`)
- Session store JSONL (`src/session/store.ts`)
- Job store JSON (`src/jobs/store.ts`)
- Engine de comandos inicial (`src/engine/simple-engine.ts`)

## Fluxo

1. Usuario envia mensagem para `POST /chat`.
2. Mensagem e persistida em transcript JSONL por `sessionKey`.
3. Engine interpreta comandos slash.
4. Para jobs de video, o processo ffmpeg/ffprobe e iniciado assincronamente.
5. Resposta do assistente e persistida e retornada.

## Decisoes estruturais da fase

- Processo unico (sem separacao gateway/worker remoto).
- Persistencia local simples (JSON + JSONL).
- Contrato de engine ja desacoplado para evolucao futura.

## Limites conhecidos da fase

- Sem retry/backoff.
- Sem dedupe/idempotency.
- Sem fallback classificado de modelo.
