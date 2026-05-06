# Arquitetura - Fase 2 (Agents Hibridos + Video Runtime)

Status: em andamento (implementacao principal entregue)

## Objetivo

Acoplar um runtime de agentes real sem perder operacao local deterministica para comandos de video.

## Componentes-chave

- Agents factory (`src/agents/factory.ts`)
- Pi adapter (`src/agents/pi-engine-adapter.ts`)
- Bootstrap de prompt/identidade via `SOUL.md` (`src/config.ts`)
- Agents hibridos (`src/agents/hybrid-engine.ts`)
- Video capability runtime (`src/capabilities/video/job-service.ts`)
- Config global/home (`src/global-config.ts`, `src/config.ts`)

## Modos de engine

- `simple`: apenas comandos locais.
- `pi`: runtime PI embutido via SDK.
- `hybrid`: slash commands locais + conversa via PI com fallback para simple.

## Expansao de tools de video

- `transcode`
- `convert_hls`
- `capture_stream`
- `probe_media`

## Fluxo (modo hybrid)

1. Mensagem chega em `/chat`.
2. Se for slash command, vai direto para executor local.
3. Se for texto livre, tenta `PiEngineAdapter`.
4. `PiEngineAdapter` usa `system prompt` montado com `docs/core/SOUL.md`.
5. Se PI falhar, fallback para `SimpleCommandEngine`.
6. Resultado e persistido na sessao.

## Valor arquitetural da fase

- Preserva operabilidade mesmo sem provider externo.
- Mantem contrato unico (`AgentEngine`) para trocas futuras.
- Cria base para resiliencia da Fase 3.
