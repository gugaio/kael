# OpenClaw: Aspectos Mais Interessantes para Copiar

Lista dos padrões e arquiteturas únicas do OpenClaw que valem aprender para um projeto inicial, separadas de features de produção genéricas.

## Aspectos Únicos do OpenClaw

### 1. Gateway Single-Process como Plano de Controle

**Por que é único:**
- Unifica HTTP/WS server + channels + cron + heartbeat + agent runtime em **um único processo Node.js**
- Elimina overhead de IPC entre componentes
- Permite acesso irrestrito à máquina local (commands, arquivos, GPU, microfone) sem complexidade de volumes/permissoes
- Arquitetura robusta: se gateway cai, tudo para (esperado), mas não tem comunicação parcial quebrada

**Código de referência:**
```typescript
// src/gateway/server.impl.ts:155
export async function startGatewayServer(params: StartGatewayParams) {
  const runtimeState = createGatewayRuntimeState(params);
  // Cria HTTP + WS + channels + cron + heartbeat tudo aqui
  return runtimeState;
}
```

**Como copiar para nosso projeto:**
- Se precisar de acesso local irrestrito (AI agent precisa executar commands)
- Gateway = runtime unificado, não "API server separado"
- Single point of failure, mas simplifica arquitetura

---

### 2. WebSocket Dedupe com Idempotency

**Por que é único:**
- `context.dedupe` armazena resultados de requests em andamento
- Se mesmo `idempotencyKey` chegar enquanto ainda está processando, retorna resultado cacheado imediatamente
- Evita re-execução de requests idempotentes (ex: retries simultâneos de cliente)

**Código de referência:**
```typescript
// src/gateway/server-methods/agent.ts:100-106
const cached = context.dedupe.get(`agent:${idem}`);
if (cached) {
  respond(cached.ok, cached.payload, cached.error, {cached: true});
  return;  // Não re-executa
}
```

**Como copiar para nosso projeto:**
- Padrão de resiliência para idempotencia
- Cache em memória com timestamp (`ts: Date.now()`)
- Return early se request já está processando

---

### 3. Model Fallback com Classificação de Erro

**Por que é único:**
- Não é só "lista de modelos para tentar"
- Classifica erro (rate limit, auth, billing, compaction failure, etc.) e escolhe alternativa **apropriada**
- `runWithModelFallback` loopa até sucesso ou fim dos fallbacks configurados

**Código de referência:**
```typescript
// src/agents/pi-embedded-helpers.ts
const reason = classifyFailoverReason(errorText, provider, model);
if (reason === "rate_limit") {
  // Tenta provider/model alternativo
} else if (reason === "billing") {
  // Muda provider
}
```

**Como copiar para nosso projeto:**
- Classificar erros (não só verificar status code)
- Ter mapa de "erro → ação alternativa"
- Loop de fallback ordenado (tentar A → B → C, não A → C → B)

---

### 4. Context Window Guard + Auto-Compaction

**Por que é único:**
- Protege proativamente contra overflow de contexto (tokens > limit)
- Calcula `estimatedTokens` ANTES de chamar API
- Se próximo turno vai explodir, compacta automaticamente
- Evita erros "context too long" de forma reativa

**Código de referência:**
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

**Como copiar para nosso projeto:**
- Calcular custo estimado de cada turno (tokens)
- Compactar proativamente, não só após erro
- Limpar mensagens antigas com heurística (ex: manter últimas N mensagens)

---

### 5. Heartbeat como Turno Periódico com ACK

**Por que é único:**
- Não é "ping" simples, é um **turno de agente** executado periodicamente
- Espera resposta `HEARTBEAT_OK` para suprimir output quando não há nada relevante
- Se houver alerta importante, envia para alvo configurado
- Contrato claro entre heartbeat runner e agente

**Código de referência:**
```typescript
// src/infra/heartbeat-runner.ts
const result = await runEmbeddedPiAgent({...});
if (result.payloads?.some(p => p.text?.includes("HEARTBEAT_OK"))) {
  // Suprime resposta, é só ACK
  return;
}
```

**Como copiar para nosso projeto:**
- Turno de agente com mensagem especial (token/flag)
- Supressão de output "vazio" (não spam usuário)
- Agendamento periódico (ex: a cada 5 minutos)

---

### 6. Cron Persistente com Catch-up

**Por que é único:**
- Jobs armazenados em JSON com `nextRunAt` calculado
- Se gateway restarta, jobs perdidos são executados no próximo ciclo
- Robustez: não perde agendamentos por crash/restart
- Suporta cron expressions complexas (`*/5 * * * *`)

**Código de referência:**
```typescript
// src/cron/service/timer.ts
const job = {
  id: "job-123",
  expression: "*/5 * * * *",  // A cada 5 minutos
  nextRunAt: calculateNextRun(expression),
};
if (now > job.nextRunAt) {
  // Executa job perdido (catch-up)
}
```

**Como copiar para nosso projeto:**
- Persistir jobs em JSON com timestamp
- No startup, verificar jobs atrasados
- Usar lib de cron parsing (ex: cron-parser)

---

### 7. Session Reset Automático em Falhas Irrecuperáveis

**Por que é único:**
- Detecta falhas irrecuperáveis (compaction failure, context overflow, role ordering conflicts, session corruption)
- Cria nova sessão automaticamente (novo `sessionId`, novo transcript)
- Informa usuário que sessão foi resetada
- Evita ficar em estado quebrado indefinidamente

**Código de referência:**
```typescript
// src/auto-reply/reply/agent-runner-execution.ts
if (isContextOverflowError(error)) {
  await resetSession(sessionKey);
  return { payloads: [{text: "Sessão resetada devido a contexto excedido."}]};
}
```

**Como copiar para nosso projeto:**
- Classificar erros como "recuperáveis" vs "fatais"
- Reset automático com mensagem ao usuário
- Limpeza de estado quebrado

---

### 8. JSONL Transcripts Eficientes

**Por que é único:**
- Uma mensagem por linha em JSONL
- Eficiente para streaming (append no final)
- Fácil de ler/parse (line-by-line)
- Compactação simples (remover linhas antigas)

**Código de referência:**
```typescript
// SessionManager.appendMessage()
const line = JSON.stringify({
  role: "user",
  content: message,
  timestamp: Date.now(),
});
await fs.appendFile(transcriptPath, line + "\n");
```

**Como copiar para nosso projeto:**
- JSONL para streaming (uma mensagem por linha)
- Simples de ler: `fs.readFile().split('\n')`
- Compactação: remover linhas antigas

---

## Classificação

| Aspecto | Único do OpenClaw? | Por que? | Vale copiar? |
|-----------|------------------------|---------|----------------|
| Gateway single-process | ✅ Sim | Acesso local irrestrito em um processo | ✅ Se precisar |
| WebSocket dedupe | ✅ Sim | Padrão de resiliência idempotente | ✅ Sim |
| Model fallback classificado | ✅ Sim | Entender erro para escolher alternativa | ✅ Sim |
| Context window guard | ✅ Sim | Proteção proativa contra overflow | ✅ Sim |
| Heartbeat com ACK | ✅ Sim | Turno de agente com supressão de ruído | ✅ Sim |
| Cron persistente + catch-up | ✅ Sim | Robustez de scheduler | ✅ Sim |
| Session reset automático | ✅ Sim | Autorecupação de falhas | ✅ Sim |
| JSONL transcripts | ❌ Não | Padrão comum em sistemas de logs | ❌ Qualquer |

## O que NÃO é tão interessante

- **Skills/workspace scan** - Vários frameworks fazem (MCP, LangChain)
- **WebSocket em si** - Protocolo padrão, nada de especial
- **Auto-reply layer** - É orquestração de produção (20+ arquivos), interessante mas overkill para MVP
- **Multi-channel (Telegram, Signal, Slack)** - É feature de produção, padrão de chat apps
- **Typing indicators, followup** - UX de chat, não arquitetura core
- **Link/media understanding** - Interpretação avançada, mas não única

## Como usar esta lista

**Para projeto inicial (MVP):**
1. Comece copiar 1-3 (gateway, dedupe, fallback classificado)
2. Context window guard se usar LLM com limite de tokens
3. JSONL para se você vai persistir conversação
4. Session reset se for robusto a falhas
5. Heartbeat/cron se precisar de agendamento/monitoring

**Quando adicionar outros:**
6. Cron persistente se precisar de scheduler robusto
7. Multi-channel se for para produção
8. Skills/other features avançadas depois de core sólido

## Arquivos de Referência

```
src/gateway/server.impl.ts:155        # Gateway entry point
src/gateway/server-methods/agent.ts:363 # Dedupe
src/agents/model-fallback.ts               # Model fallback
src/agents/pi-embedded-helpers.ts       # Classificação de erro
src/agents/context-window-guard.ts         # Context guard
src/infra/heartbeat-runner.ts             # Heartbeat
src/cron/service/timer.ts                 # Cron
src/auto-reply/reply/agent-runner-execution.ts  # Session reset
src/config/sessions.ts                     # Session store
```
