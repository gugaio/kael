# Gateway: Fluxo Completo de Envio

Diagrama detalhado do fluxo de ponta a ponta via Gateway, desde o CLI até a resposta chegar de volta.

## Fluxo Completo

```
┌───────────────────────────────────────────────────────────────┐
│  CLI: openclaw agent --message "ola" --to +1555...  │
└───────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────────┐
│  1. CLI PROCESSAMENTO                                  │
│  src/cli/program/register.agent.ts:73                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ opts.local === false?                              │ │
│  └──────┬─────────────────────────────────────────────┘ │ │
│          │ false?                                      │ │
│          ▼                                              │ │
│  → agentViaGatewayCommand()                             │ │
│  ┌────────────────────────────────────────────────────────────┐ │ │
│  │ 2. CONNECT WEBSOCKET                              │ │ │
│  └────────────────────────────────────────────────────────────┘ │ │
└───────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────────┐
│  3. GATEWAY CLIENT                                    │
│  src/gateway/call.ts:156 (callGateway)                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Resolve URL: ws://127.0.0.1:18789                │ │
│  │ Load config local                                     │ │
│  │ Connect WebSocket (GatewayClient)                      │ │
│  └────────────────────────────────────────────────────────────┘ │ │
└───────────────────────────────────────────────────────────────────┘
                          │
                          ▼ WebSocket Frame
┌───────────────────────────────────────────────────────────────────┐
│  4. GATEWAY SERVER - RECEPÇÃO                           │
│  src/gateway/server-methods/agent.ts:46 (agent)        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Validate params (linhas 48-58)                   │ │
│  │ - message obrigatório                                 │ │
│  │ - agentId conhecido?                               │ │
│  │ - to/sessionKey válido?                               │ │
│  │ - channels conhecidos?                                 │ │
│  └────────────────────────────────────────────────────────────┘ │ │
│          │                                              │ │
│          ▼                                              │ │
│  ┌────────────────────────────────────────────────────────────┐ │ │
│  │ Dedupe check (linhas 100-106)                    │ │
│  │ context.dedupe.get(agent:{idem})                 │ │
│  │ Se cached → responde imediatamente                  │ │
│  └────────────────────────────────────────────────────────────┘ │ │
│          │ não cached                                     │ │
│          ▼                                              │ │
│  ┌────────────────────────────────────────────────────────────┐ │ │
│  │ Parse attachments/timestamp (linhas 107-146)         │ │
│  │ - Anexos base64 → message + images                │ │
│  │ - Inject timestamp se não existir                    │ │
│  └────────────────────────────────────────────────────────────┘ │ │
│          │                                              │ │
│          ▼                                              │ │
│  ┌────────────────────────────────────────────────────────────┐ │ │
│  │ Resolve session (linhas 168-297)                  │ │
│  │ - Se sessionKey existe → loadSessionEntry              │ │
│  │ - Se não → gera novo sessionId (UUID)               │ │
│  │ - Update session store (updatedAt, skills, etc.)       │ │
│  │ - Check send policy (deny se bloqueado)              │ │
│  └────────────────────────────────────────────────────────────┘ │ │
│          │                                              │ │
│          ▼                                              │ │
│  ┌────────────────────────────────────────────────────────────┐ │ │
│  │ Send "accepted" response (linha 368)                │ │
│  │ respond(true, {                                    │ │
│  │   runId,                                          │ │
│  │   status: "accepted",                               │ │
│  │   acceptedAt: Date.now()                            │ │
│  │ })                                                │ │
│  │ → Cliente CLI recebe ack e espera                    │ │
│  └────────────────────────────────────────────────────────────┘ │ │
│          │                                              │ │
│          ▼                                              │ │
│  ┌────────────────────────────────────────────────────────────┐ │ │
│  │ 5. EXECUTE AGENT (linha 372)                     │ │
│  │ void agentCommand({...})                              │ │
│  │ → src/commands/agent.ts (mesmo código que --local) │ │
│  └────────────────────────────────────────────────────────────┘ │ │
└───────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────────┐
│  6. DISPATCH FLOW                                     │
│  src/auto-reply/reply/get-reply.ts:53 (getReplyFromConfig)  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Resolve agentId, workspace, model                   │ │
│  │ Ensure workspace (bootstrap, AGENTS.md)             │ │
│  │ initSessionState (resolve/create session)               │ │
│  │ Media understanding, link understanding                  │ │
│  │ Command authorization, directives                     │ │
│  └────────────────────────────────────────────────────────────┘ │ │
│          │                                              │ │
│          ▼                                              │ │
│  ┌────────────────────────────────────────────────────────────┐ │ │
│  │ runPreparedReply() (monta prompt/context)         │ │
│  │ → src/auto-reply/reply/get-reply-run.ts           │ │
│  │ - build system prompt                              │ │
│  │ - load skills snapshot                              │ │
│  │ - resolve thinking/verbose levels                   │ │
│  │ - apply session hints                             │ │
│  └────────────────────────────────────────────────────────────┘ │ │
│          │                                              │ │
│          ▼                                              │ │
│  ┌────────────────────────────────────────────────────────────┐ │ │
│  │ runReplyAgent() (runner com queue/typing)           │ │
│  │ → src/auto-reply/reply/agent-runner.ts             │ │
│  │ - createTypingSignaler (typing channel)             │ │
│  │ - queue management (steer, followup)              │ │
│  │ - block reply pipeline (voice TTS)                 │ │
│  └────────────────────────────────────────────────────────────┘ │ │
└───────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────────┐
│  7. EXECUÇÃO COM FALLBACK                              │
│  src/auto-reply/reply/agent-runner-execution.ts             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ runAgentTurnWithFallback()                           │ │
│  │ → src/agents/model-fallback.ts                   │ │
│  │ Loop com:                                         │ │
│  │   1. runEmbeddedPiAgent()                          │ │
│  │   2. Se erro → classifica (rate limit, auth, etc.) │ │
│  │   3. Tenta provider/model alternativo            │ │
│  │   4. Repete até sucesso ou fim dos fallbacks     │ │
│  └────────────────────────────────────────────────────────────┘ │ │
│          │                                              │ │
│          ▼                                              │ │
│  ┌────────────────────────────────────────────────────────────┐ │ │
│  │ runEmbeddedPiAgent() (PI Agent embedded)             │ │
│  │ → src/agents/pi-embedded-runner/run.ts            │ │
│  │ - runEmbeddedAttempt() (API call real)            │ │
│  │   → Anthropic / Ollama / etc.                   │ │
│  │ - Stream response + tool calls                     │ │
│  │ - Persist transcript (JSONL)                         │ │
│  │ - Context window guard (overflow/compaction)         │ │
│  │ - Auth profile resolution                           │ │
│  └────────────────────────────────────────────────────────────┘ │ │
│          │                                              │ │
│          ▼ result (payloads + meta)                         │ │
└───────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────────┐
│  8. GATEWAY RESPONSE                                  │
│  src/gateway/server-methods/agent.ts:407-421               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ const payload = {                                   │ │
│  │   runId,                                          │ │
│  │   status: "ok",                                   │ │
│  │   summary: "completed",                             │ │
│  │   result: { payloads, meta }                       │ │
│  │ };                                                 │ │
│  │ context.dedupe.set(agent:{idem}, payload)         │ │
│  │ respond(true, payload, undefined, {runId})          │ │
│  │ → Cliente CLI recebe payload final                      │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────────┐
│  9. CLI OUTPUT                                        │
│  src/commands/agent-via-gateway.ts:152-170               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ const result = response?.result;                      │ │
│  │ const payloads = result?.payloads ?? [];             │ │
│  │ for (payload of payloads) {                        │ │
│  │   const out = formatPayloadForLog(payload);          │ │
│  │   runtime.log(out);  // Output texto + MEDIA:url    │ │
│  │ }                                                 │ │
│  │ Se --deliver → delivery via channel                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

## Fases Detalhadas

### Fase 1: CLI → Gateway Client
```
CLI: openclaw agent --message "ola" --to +15551234567
  ↓
src/cli/program/register.agent.ts:73
  ↓ opts.local === false
  ↓
agentViaGatewayCommand(src/commands/agent-via-gateway.ts:86)
  ↓
callGateway(src/gateway/call.ts:156)
  ├─ Resolve URL: ws://127.0.0.1:18789
  ├─ Load config local (~/.openclaw/config.json)
  ├─ Connect WebSocket (GatewayClient)
  └─ Send: {method: "agent", params: {message, to, ...}}
```

### Fase 2: Gateway Server - Validação
```
src/gateway/server-methods/agent.ts:46
  ↓ agentHandlers.agent
  ↓ validateAgentParams(p) [linhas 48-58]
  ├─ message obrigatório
  ├─ agentId conhecido?
  ├─ to/sessionKey válido?
  └─ channels conhecidos?
  ↓
Dedupe check [linhas 100-106]
  ├─ context.dedupe.get(agent:{idem})
  ├─ Se cached → respond(cached) imediato
  └─ Se não → continua
  ↓
Parse [linhas 107-146]
  ├─ Anexos base64 → message + images
  └─ Inject timestamp se necessário
  ↓
Resolve session [linhas 168-297]
  ├─ Se sessionKey → loadSessionEntry
  ├─ Se não → gera novo sessionId (UUID)
  ├─ Update session store
  ├─ Check send policy
  └─ Register agent run context
  ↓
Send accepted [linha 368]
  └─ respond(true, {runId, status: "accepted", ...})
```

### Fase 3: Dispatch
```
agentCommand(src/commands/agent.ts:64) [linha 372]
  ↓
getReplyFromConfig(src/auto-reply/reply/get-reply.ts:53)
  ├─ Resolve agentId, workspace, model
  ├─ Ensure workspace (bootstrap, AGENTS.md)
  ├─ initSessionState
  ├─ Media understanding
  ├─ Link understanding
  ├─ Command authorization
  └─ Resolve directives
  ↓
runPreparedReply(src/auto-reply/reply/get-reply-run.ts:110)
  ├─ Build system prompt
  ├─ Load skills snapshot
  ├─ Resolve thinking/verbose
  └─ Apply session hints
  ↓
runReplyAgent(src/auto-reply/reply/agent-runner.ts:47)
  ├─ Create typing signaler
  ├─ Queue management
  ├─ Block reply pipeline (voice/TTS)
  └─ followup runner
  ↓
runAgentTurnWithFallback(src/auto-reply/reply/agent-runner-execution.ts)
  └─ runWithModelFallback loop
```

### Fase 4: PI Agent Embedded
```
runWithModelFallback(src/agents/model-fallback.ts)
  ↓ Loop:
  ├─ runEmbeddedPiAgent(src/agents/pi-embedded-runner/run.ts)
  │   ├─ runEmbeddedAttempt()
  │   ├─ API call real (Anthropic/Ollama/etc)
  │   ├─ Stream response + tool calls
  │   ├─ Persist transcript (JSONL)
  │   ├─ Context window guard
  │   └─ Auth profile resolution
  ├─ Se erro → classifica (FailoverError)
  ├─ Tenta provider/model alternativo
  └─ Repete até sucesso ou fim
  ↓
Result payload
  └─ {runId, status: "ok", summary: "completed", result: {payloads, meta}}
```

### Fase 5: Gateway Response → CLI
```
src/gateway/server-methods/agent.ts:407-421
  ↓
respond(true, payload, undefined, {runId})
  ↓ Update dedupe: context.dedupe.set(agent:{idem}, payload)
  ↓ WebSocket frame volta ao cliente
  ↓
CLI processa response (src/commands/agent-via-gateway.ts:152-170)
  ├─ const payloads = result?.payloads ?? []
  ├─ for (payload of payloads) {
  │   const out = formatPayloadForLog(payload)
  │   runtime.log(out)  // Texto + MEDIA:url
  │ }
  └─ Se --deliver → delivery via channel
```

## WebSocket Frame Format

### Request (CLI → Gateway)
```json
{
  "method": "agent",
  "params": {
    "message": "ola",
    "to": "+15551234567",
    "agentId": "main",
    "thinking": "high",
    "verbose": "on",
    "deliver": false,
    "sessionKey": "agent:main:telegram:user:123",
    "idempotencyKey": "uuid-1234",
    "timeout": 600
  }
}
```

### Response 1: Accepted (Gateway → CLI)
```json
{
  "runId": "run-uuid-5678",
  "status": "accepted",
  "acceptedAt": 1739876543000
}
```

### Response 2: Final (Gateway → CLI)
```json
{
  "runId": "run-uuid-5678",
  "status": "ok",
  "summary": "completed",
  "result": {
    "payloads": [
      {
        "text": "Olá! Como posso ajudar?",
        "mediaUrl": null
      }
    ],
    "meta": {
      "provider": "anthropic",
      "model": "claude-sonnet-4",
      "usage": {
        "inputTokens": 100,
        "outputTokens": 50,
        "total": 150
      }
    }
  }
}
```

## Arquivos-chave por Fase

| Fase | Arquivo | Responsabilidade |
|-------|---------|----------------|
| **CLI → Gateway** | `src/commands/agent-via-gateway.ts:86` | Conexão WebSocket |
| **Gateway Client** | `src/gateway/call.ts:156` | Resolve URL, auth, connect |
| **Gateway Server - Receive** | `src/gateway/server-methods/agent.ts:46` | Validação, dedupe, parse |
| **Gateway Server - Dispatch** | `src/gateway/server-methods/agent.ts:372` | Chama agentCommand |
| **Agent Command** | `src/commands/agent.ts:64` | Prepara tudo para execução |
| **Dispatch Entry** | `src/auto-reply/reply/get-reply.ts:53` | Resolve workspace, session |
| **Prepared Reply** | `src/auto-reply/reply/get-reply-run.ts:110` | Monta prompt/context |
| **Agent Runner** | `src/auto-reply/reply/agent-runner.ts:47` | Queue, typing, block reply |
| **Execution w/ Fallback** | `src/auto-reply/reply/agent-runner-execution.ts` | Loop de retry/fallback |
| **Model Fallback** | `src/agents/model-fallback.ts` | Classifica erro, tenta provider alt |
| **PI Agent Embedded** | `src/agents/pi-embedded-runner/run.ts` | API call real, stream, persist |
| **Gateway Response** | `src/gateway/server-methods/agent.ts:407` | Formata payload final |
| **CLI Output** | `src/commands/agent-via-gateway.ts:152` | Loga resultado |

## Conceitos-chave

### Idempotency
```typescript
// src/gateway/server-methods/agent.ts:90
const idem = request.idempotencyKey;  // UUID do request

const cached = context.dedupe.get(`agent:${idem}`);
if (cached) {
  respond(cached.ok, cached.payload, cached.error, {cached: true});
  return;  // Não executa de novo
}
```

### Dedupe
```typescript
// src/gateway/server-methods/agent.ts:363-367
context.dedupe.set(`agent:${idem}`, {
  ts: Date.now(),
  ok: true,
  payload: {runId, status: "accepted"}  // ACK
});

// Depois:
context.dedupe.set(`agent:${idem}`, {
  ts: Date.now(),
  ok: true,
  payload: {runId, status: "ok", result}  // Final
});
```

### Session Context
```typescript
// src/gateway/server-methods/agent.ts:296
registerAgentRunContext(runId, {
  sessionKey: requestedSessionKey,
  verboseLevel: resolvedVerboseLevel,
});

// Usado para:
// - Tool events (cross-session sharing)
// - Typing notification
// - Abort signal propagation
```

### Model Fallback
```typescript
// src/agents/model-fallback.ts
runWithModelFallback({
  cfg,
  provider: "anthropic",
  model: "claude-sonnet-4",
  fallbacks: [
    {provider: "openai", model: "gpt-4"},
    {provider: "ollama", model: "llama3"},
  ],
  run: (provider, model) => runEmbeddedPiAgent({...})
});
```

## Timing

```
T0 ───────────────────────────────────────────────────
CLI executa
  │
  ▼ [~5ms] Gateway client connect
T1 ───────────────────────────────────────────────────
WebSocket frame enviado
  │
  ▼ [~10ms] Gateway server recebe e valida
T2 ───────────────────────────────────────────────────
  │
  ▼ [~20ms] Validação, dedupe, session resolve
T3 ───────────────────────────────────────────────────
Send accepted frame
  │
  ▼ [~5ms] CLI recebe ACK
T4 ───────────────────────────────────────────────────
  │
  ▼ [~50ms] Gateway inicia agentCommand
T5 ───────────────────────────────────────────────────
  │
  ▼ [~100ms] Dispatch: load workspace, build prompt
T6 ───────────────────────────────────────────────────
  │
  ▼ [~200ms] Run: queue, typing, etc.
T7 ───────────────────────────────────────────────────
  │
  ▼ [API call real] 500-5000ms dependendo do model
T8 ───────────────────────────────────────────────────
Gateway envia final frame
  │
  ▼ [~10ms] CLI recebe e loga
```

## Comparação com Local (`--local`)

| Aspecto | Local | Gateway |
|---------|-------|----------|
| **Conexão** | Direto no processo | WebSocket (ws://127.0.0.1:18789) |
| **Latência** | ~0ms overhead | ~15-25ms overhead (WebSocket) |
| **Dedupe** | Não existe | ✅ context.dedupe |
| **Session persistence** | Direta | Via Gateway (mesmo código) |
| **Agent execution** | ✅ Mesmo código | ✅ Mesmo código |
| **Model fallback** | ✅ Mesmo código | ✅ Mesmo código |
| **Tool events** | N/A | ✅ Gateway can broadcast |
| **Typing channel** | ✅ | ✅ (cross-session) |
| **Delivery** | CLI processa | Gateway dispatcha |
