# Guia de Desenvolvimento - [NOME_DO_PROJETO] Code Agent

Este documento guia o desenvolvimento do agente [NOME DO PROJETO], usando OpenClaw como referência técnica para arquitetura e padrões.

## Visão Geral

[NOME DO PROJETO] é um assistente AI local que usa OpenClaw como base de:
- Arquitetura: Gateway single-process + PI Agent embedded
- Resiliência: Retry w/ backoff, model failover, session recovery
- Autonomia: Cron + heartbeat
- Session management: JSONL transcripts

## Arquitetura de Referência (OpenClaw)

OpenClaw é uma implementação battle-tested de um agente AI local com as seguintes características:

### Single-Process Gateway

OpenClaw implementa um processo Node.js único que unifica todos os componentes:

```
┌─────────────────────────────────────────────────────────┐
│  Gateway (single process)                          │
├──────────────────────────────────────────────────────────┤
│  Fastify HTTP/WS Server                          │
│  ├─ Routes: /chat, /agent, /health            │
│  └─ WebSocket plugin (real-time)               │
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

**Benefícios:**
- Zero overhead de IPC entre componentes
- State sharing via memória compartilhada direta
- Performance: chamadas de função diretas, sem network
- Simplicidade de deployment: um processo só

### Session Management

**Estrutura:**
- `sessionKey`: identificador lógico (ex: `agent:main:telegram:user:123`)
- `sessionId`: UUID único por conversação
- `sessionFile`: path para transcript JSONL
- `storePath`: JSON com metadados de todas as sessões

**Transcripts:**
- Uma mensagem por linha em JSON (append-only)
- Eficiente para streaming (não precisa carregar arquivo inteiro)
- Compaction: criar novo arquivo quando contexto excede limite

### PI Agent Embedded

Runtime do agente que roda no mesmo processo do gateway:

**Features:**
- Tools: exec (bash commands), readFile, writeFile, git
- Streaming: resposta stream de tokens
- Context window guard: proteção proativa contra overflow
- Auto-compaction: compactação automática quando necessário

### Resiliência Multi-Camada

**Retry com Backoff:**
- Exponential backoff com jitter
- Políticas de retry por provider (Telegram, Discord, etc.)
- Não tenta imediatamente em falha transitória

**Model Failover Classificado:**
- Classifica erro (rate limit, auth, billing, server error, etc.)
- Troca para provider/modelo apropriado baseada no tipo de erro
- Não é só "lista de modelos para tentar"

**Session Recovery:**
- Reset automático em falhas irrecuperáveis:
  - Context overflow → nova sessão + mensagem ao usuário
  - Compaction failure → reset + retry
  - Role ordering conflict → delete transcript + nova sessão
  - Session corruption → delete transcript + nova sessão

## Conceitos-Chave a Implementar

### 1. Gateway como Runtime Central

**Entry Point:**
```typescript
// src/gateway/server.impl.ts:155
export async function startGatewayServer(params: StartGatewayParams) {
  const runtimeState = createGatewayRuntimeState(params);
  // Cria HTTP + WS + channels + cron + heartbeat
  return runtimeState;
}
```

**Métodos do Gateway:**
- `chat.send` → envia mensagem, retorna resposta do agente
- `agent.invoke` → executa agente com mais controle
- `/health` → health check

### 2. WebSocket Dedupe para Idempotency

Evita re-execução de requests idempotentes:

```typescript
// src/gateway/server-methods/agent.ts:100-106
const cached = context.dedupe.get(`agent:${idem}`);
if (cached) {
  respond(cached.ok, cached.payload, cached.error, {cached: true});
  return;  // Não re-executa
}
```

### 3. Model Fallback Classificado

Não é só "lista para tentar", entende o erro:

```typescript
// src/agents/pi-embedded-helpers.ts
const reason = classifyFailoverReason(errorText, provider, model);
if (reason === "rate_limit") {
  // Tenta provider/model alternativo adequado
} else if (reason === "auth") {
  // Tenta com auth profile diferente
}
```

### 4. Context Window Guard

Proteção proativa contra overflow:

```typescript
// src/agents/context-window-guard.ts
const guardResult = evaluateContextWindowGuard({
  existingTokens: sessionEntry.contextTokens,
  nextMessageLength: message.length,
  maxTokens: MODEL_LIMIT,
});
if (guardResult.shouldCompact) {
  // Compacta antes de chamar API
}
```

### 5. Cron Persistente

Jobs armazenados em JSON com catch-up após restart:

```typescript
// src/cron/service/timer.ts
const job = {
  id: "job-123",
  expression: "*/5 * * *",  // A cada 5 minutos
  nextRunAt: calculateNextRun(expression),
};
if (now > job.nextRunAt) {
  // Executa job perdido (catch-up)
}
```

### 6. Heartbeat com Contrato

Turno periódico com contrato claro:

```typescript
// src/infra/heartbeat-runner.ts
const result = await runEmbeddedPiAgent({...});
if (result.payloads?.some(p => p.text?.includes("HEARTBEAT_OK"))) {
  // Suprime resposta, é só ACK
  return;
}
```

## Padrões de Código

### 1. TypeScript Strict

```typescript
// tsconfig.json
{
  "strict": true,
  "noImplicitAny": true,
  "noUnusedLocals": true
}
```

### 2. Error Handling

```typescript
// Classificar erro, não só capturar
try {
  await someOperation();
} catch (error) {
  const reason = classifyError(error.message);
  throw new RecoverableError(reason);
}
```

### 3. Logging Estruturado

```typescript
// Usar logger com níveis
log.info("Iniciando agent");
log.error("Falha na execução", {error});
log.verbose("Tokens usados", {input, output});
```

## Arquivos-chave do OpenClaw para Estudar

| Arquivo | O que estudar | Por que? |
|---------|----------------|---------|
| `src/gateway/server.impl.ts:155` | Gateway entry point | Como unificar tudo em um processo |
| `src/gateway/server-runtime-state.ts:29` | Cria HTTP/WS | Como configurar servers |
| `src/auto-reply/reply/session.ts` | Session management | Como gerenciar sessões |
| `src/agents/pi-embedded-runner/run.ts` | PI Agent wrapper | Como roda agente |
| `src/infra/retry.ts` | Retry w/ backoff | Padrão de backoff exponencial |
| `src/agents/model-fallback.ts` | Model failover | Classificação de erro |
| `src/agents/context-window-guard.ts` | Context guard | Proteção proativa contra overflow |
| `src/infra/heartbeat-runner.ts` | Heartbeat | Turno periódico com ACK |
| `src/cron/service/timer.ts` | Cron | Jobs persistentes com catch-up |
| `docs/concepts/retry.md` | Documentação | Conceitos de retry |
| `docs/concepts/model-failover.md` | Documentação | Conceitos de failover |
| `docs/gateway/heartbeat.md` | Documentação | Conceitos de heartbeat |
| `docs/automation/cron-jobs.md` | Documentação | Conceitos de cron |

## Roadmap de Implementação

### Fase 1: Core Gateway
- [ ] Fastify HTTP server
- [ ] WebSocket plugin para real-time
- [ ] Message handler (chat.send)
- [ ] Basic session management

### Fase 2: PI Agent
- [ ] runEmbeddedPiAgent wrapper
- [ ] Tools básicos (exec, fs)
- [ ] System prompt básico

### Fase 3: Resiliência Básica
- [ ] Retry com backoff exponencial
- [ ] Model fallback classificado (opcional)
- [ ] Context window guard

### Fase 4: Autonomia
- [ ] Cron service (jobs periódicos)
- [ ] Heartbeat básico

## Boas Práticas

### 1. Começar Simples
- Implementar core primeiro (Gateway + PI Agent + sessions)
- Adicionar resiliência depois que core estiver estável
- Não implementar features avançadas cedo

### 2. Testes
- Testar session management (criação, reset, compaction)
- Testar retry em falhas simuladas
- Testar model fallback se implementar

### 3. Documentação
- Comentários claros em código ("por que" não "o que")
- Atualizar este guia conforme aprendizado

## Diferenças vs OpenClaw

Este projeto não precisa de:
- Multi-channel (Telegram, Signal, Slack, etc.)
- Skills complexas (workspace scan, templates)
- UI web inicial (pode ser CLI-only)
- Plugins system extensivo

Focar em:
- Gateway single-process
- PI Agent embedded
- Resiliência core
- CLI simples
