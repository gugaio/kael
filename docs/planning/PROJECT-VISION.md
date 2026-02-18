# Project Vision - [NOME_DO_PROJETO] - AI Assistant Local

## Visão Geral

[NOME DO PROJETO] - Super assistente 24/7 com foco em:
- **Assistente geral** → conversação, comandos, automação, busca na web, análise de documentos
- **Automação** (cron, bash commands extensivos)
- **Memória persistente** (versões, contexto longo-prazo)
- **Interface web dedicada** (chat focado em falar com o [NOME DO PROJETO])
- **Resiliência** (retry, failover, recovery)
- **Futuras especializações** → [ÁREAS FUTURAS DO PROJETO]

## Objetivos Principais

1. **Assistente geral**: conversação natural, execução de comandos bash de forma segura (sandbox quando necessário)
2. Interface web dedicada (chat focado em falar com o [NOME DO PROJETO])
3. Resiliência (retry, failover, recovery)
4. Automação básica (cron)
5. Memória persistente (transcripts JSONL com contexto longo-prazo)

## Stack Tecnológica Sugerida (Baseada em OpenClaw)

| Componente | Tecnologia | Por que? (OpenClaw) |
|------------|-------------|-------------------|
| Runtime | Node.js 22+ + TypeScript | Battle-tested, ecosystem moderno |
| Agent Runtime | PI Agent Core + PI Coding Agent | Tools de coding, system prompt robusto |
| HTTP Server | **Fastify 4.x** + `@fastify/websocket` | Mais rápido, schema validation nativa |
| WS Server | `@fastify/websocket` plugin nativo | Melhor performance que ws standalone |
| Session Store | JSON + JSONL (append-only) | Simples, eficiente, streaming-friendly |
| Bash Integration | child_process exec + sandbox | Commands seguros |
| Auth | Token/env var | Simples, seguro | Customizar conforme necessário |
| Cron | Service persistente | Jobs armazenados em JSON, catch-up após restart |
| Resiliência | Retry w/ backoff, model failover, recovery | Multi-camada |

**Nota**: Consulte OpenClaw para patterns de resiliência implementados.

## Roadmap Sugerido (Baseado em OpenClaw)

### Phase 1 - MVP: Gateway + PI Agent + CLI Básico

**Objetivo**: Assistente local que conversa, executa comandos, persiste sessões.

- **CLI**: Comandos básicos (start, config, logs)
- **Gateway**: Single process unificando HTTP/WS + Agent Runtime + Cron + Heartbeat
- **Agent**: PI Agent embedded com tools básicos (exec, fs)
- **Session**: Management com JSONL transcripts
- **Resiliência**: Retry w/ backoff, model fallback opcional

**Tech da Phase 1:**
- Fastify para HTTP routing (schema validation nativa)
- `@fastify/websocket` para real-time
- JSONL para transcripts (append-only, streaming-friendly)
- TypeScript strict
- Processo único (gateway como runtime unificado)

**O que NÃO entrega na Phase 1:**
- Multi-channel (Telegram, Signal, Slack, etc.)
- Skills complexas (workspace scan, templates)
- Vector DB (opcional, Phase 2+)
- UI web inicial (pode ser CLI-only)
- Specializações avançadas

**Padrões do OpenClaw a copiar:**
- Gateway single-process como runtime central
- WebSocket dedupe (idempotency)
- Model fallback classificado (entender erro vs trocar provider)
- Context window guard (proteção proativa contra overflow)
- Session reset automático em falhas irrecuperáveis

---

### Phase 2 - Skills Avançadas + Memória

**Objetivo**: Capacidades ricas de contexto e conhecimento.

- Skills: Templates dinâmicos, workspace scan
- Memória longo-prazo: Transcripts com contexto persistente
- Vector DB para RAG (opcional)

**Tech da Phase 2:**
- Sistema de skills com arquivos no workspace
- RAG queries sobre workspace
- System prompt modulares (base + especialidades)

**O que NÃO entrega na Phase 2:**
- Multi-session complexa (groups, threads)
- UI web completa
- Vídeo processing

**Padrões do OpenClaw a copiar:**
- System prompts modulares (base + especialidades ativas)
- Workspace bootstrapping (AGENTS.md, context files)

---

### Phase 3 - Resiliência Operacional

**Objetivo**: Autonomia operacional e recuperação robusta.

- Retry/backoff exponencial + jitter
- Model failover com classificação de erro
- Auto-compaction de sessão
- Cron service para jobs periódicos
- Heartbeat para health checks

**Tech da Phase 3:**
- Retry com backoff exponencial + jitter (ver OpenClaw `src/infra/retry.ts`)
- Políticas de retry por provider
- Cron expressions (`*/5 * * *`)
- Heartbeat runner com contrato `HEARTBEAT_OK`
- Catch-up de jobs perdidos após restart

**Padrões do OpenClaw a copiar:**
- Retry policy per-provider (Telegram, Discord, etc.)
- Classificação de erro (rate limit vs auth vs billing)
- Session reset estratégico (overflow, compaction failure, corruption)

---

### Phase 4 - Channels (Extensão) - Opcional

**Objetivo**: Integração com mensageiros.

- Plugin interface para canais
- Conector para pelo menos um mensageiro

**Tech da Phase 4:**
- Plugin system para extensibilidade
- Plugin interface unificada

**O que NÃO entrega na Phase 4:**
- Multi-channel extenso (começar com 1-2)
- Specializações por channel

**Padrões do OpenClaw a copiar:**
- Runtime de channels dentro do gateway
- Dispatch unificado para todos os canais
- Session management cross-channel

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  Processo Node.js único (gateway run)           │
├──────────────────────────────────────────────────────────┤
│  Fastify Server (HTTP + WS)                      │
│  ├─ Routes: /health, /chat, /ws            │
│  └─ WebSocket plugin (real-time)              │
│                                                    │
│  ↓ Dispatch → Agent Runtime → Response          │
│  ↓                                               │
│  Session Store (JSONL + JSON)                    │
│  ↓                                               │
│  Cron Service (jobs periódicos)               │
│  ↓                                               │
│  Heartbeat (health checks)                    │
└─────────────────────────────────────────────────────────┘
```

## Conceitos-Chave

| Conceito | Descrição |
|----------|-----------|
| Gateway Single-Process | Unifica todos componentes em um processo Node.js, sem overhead de IPC |
| SessionKey/SessionId | `sessionKey`: identificador lógico (per-sender, per-group) / `sessionId`: UUID único por conversação |
| JSONL Transcripts | Uma mensagem por linha em JSON, append-only para streaming eficiente |
| WebSocket Dedupe | `context.dedupe` evita re-execução de requests idempotentes |
| Model Fallback Classificado | Classifica erro (rate limit, auth, billing) e troca provider/modelo apropriado |
| Context Window Guard | Protege proativamente contra overflow antes de chamar API |
| Session Reset | Reset automático em falhas irrecuperáveis (overflow, compaction failure, corruption) |
| Cron Persistente | Jobs em JSON com catch-up após restart |
| Heartbeat | Turno periódico com contrato `HEARTBEAT_OK` para suprimir ruído |

## Referência Técnica

**Documentação do OpenClaw:**
- `/docs/concepts/retry.md` - Retry com backoff e jitter
- `/docs/concepts/model-failover.md` - Model failover
- `/docs/gateway/heartbeat.md` - Heartbeat
- `/docs/automation/cron-jobs.md` - Cron persistente

**Arquivos-chave do OpenClaw para estudar:**
- `src/gateway/server.impl.ts:155` - Gateway entry point
- `src/gateway/server-runtime-state.ts:29` - Cria HTTP/WS servers
- `src/auto-reply/reply/session.ts` - Session management
- `src/agents/pi-embedded-runner/run.ts` - PI Agent wrapper
- `src/infra/retry.ts` - Retry com backoff
- `src/agents/model-fallback.ts` - Model failover
- `src/agents/context-window-guard.ts` - Context window guard

## Áreas Futuras do Projeto

[LISTAR AQUI AS ÁREAS FUTURAS ESPECÍFICAS DO PROJETO]
