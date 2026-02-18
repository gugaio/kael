# Plano de Estudo OpenClaw

Este arquivo registra nosso estudo continuo do OpenClaw, com foco em entender o proprio projeto em profundidade e evoluir com seguranca.

## Objetivo do estudo

1. Dominar resiliência e confiabilidade do runtime.
2. Entender heartbeat e cron como mecanismos de autonomia operacional.
3. Entender como o projeto cria "autoconsciência" (contexto, bootstrap, regras de sessao).
4. Consolidar um mapa tecnico claro da arquitetura do OpenClaw.

## Princípios de estudo (para toda nova sessão)

1. Comecar por descoberta de contexto: `AGENTS.md`, `README.md`, `docs/concepts/*` e estrutura de `src/`.
2. Assumir contexto incompleto e confirmar no codigo antes de concluir.
3. Seguir fluxo ponta a ponta em vez de leitura isolada de arquivos.
4. Registrar decisoes, riscos e perguntas abertas ao fim de cada sessao.

## Roadmap (prioridade atual)

### Fase 1 - Resiliência de execução (ATUAL)

- Objetivo: mapear como o OpenClaw tenta cumprir objetivo ate o fim com seguranca.
- Foco:
  - Retry/backoff por provider.
  - Model failover + rotacao/cooldown de auth profiles.
  - Recuperacao de overflow de contexto, corrupcao de sessao e erro transiente HTTP.
- Arquivos-chave:
  - `docs/concepts/retry.md`
  - `docs/concepts/model-failover.md`
  - `src/infra/retry.ts`
  - `src/infra/retry-policy.ts`
  - `src/agents/model-fallback.ts`
  - `src/agents/failover-error.ts`
  - `src/auto-reply/reply/agent-runner-execution.ts`

### Fase 2 - Heartbeat + Cron + Wake (ATUAL)

- Objetivo: entender automacao periodica e agendamento preciso no gateway.
- Foco:
  - Heartbeat no main session (ack `HEARTBEAT_OK`, active hours, dedupe, suppressao de ruido).
  - Cron persistente, catch-up apos restart, timeout e backoff de jobs.
  - Fluxo de wake/system event: cron dispara evento e acorda heartbeat (`now` ou `next-heartbeat`).
- Arquivos-chave:
  - `docs/gateway/heartbeat.md`
  - `docs/automation/cron-jobs.md`
  - `docs/automation/cron-vs-heartbeat.md`
  - `src/infra/heartbeat-runner.ts`
  - `src/infra/heartbeat-wake.ts`
  - `src/infra/system-events.ts`
  - `src/cron/service/timer.ts`
  - `src/gateway/server-cron.ts`
  - `src/gateway/server-methods/cron.ts`
  - `src/agents/tools/cron-tool.ts`

### Fase 3 - Observabilidade e saude operacional

- Objetivo: saber diagnosticar problema real sem "adivinhacao".
- Foco:
  - Snapshot/cache de health.
  - `status --deep`, `health`, probes e sinais de degradacao.
  - Eventos operacionais de heartbeat/cron.
- Arquivos-chave:
  - `docs/gateway/health.md`
  - `src/commands/health.ts`
  - `src/gateway/server-methods/health.ts`
  - `src/gateway/server/health-state.ts`

### Fase 4 - Autoconsciência do agente

- Objetivo: entender como o agente se orienta no proprio workspace e limites.
- Foco:
  - Prompt de sistema e regras de heartbeat/silencio.
  - Context files/bootstrap e sessao principal vs subagente.
  - Template de `AGENTS.md` para estabelecer rotina de descoberta de contexto.
- Arquivos-chave:
  - `docs/concepts/system-prompt.md`
  - `docs/concepts/context.md`
  - `docs/reference/templates/AGENTS.md`
  - `src/agents/system-prompt.ts`
  - `src/agents/bootstrap-files.ts`
  - `src/agents/workspace.ts`

### Fase 5 - Arquitetura ampla (depois)

- Objetivo: expandir para extensibilidade e superficies adicionais.
- Foco:
  - Gateway end-to-end.
  - CLI e comandos.
  - Plugins/channels (apenas depois das fases 1-4).

## Estado atual e retomada

- Foco atual: confiabilidade + arquitetura operacional do Gateway.
- Confirmado hoje:
   - O Gateway e o proprio API server do projeto (listeners HTTP + WebSocket).
   - Channels rodam no processo do Gateway e encaminham mensagens internamente para dispatch.
   - Nem toda entrada de mensagem passa por HTTP externo (ex.: Telegram costuma entrar pelo runtime do channel); webhooks/integracoes podem entrar por HTTP.
   - Heartbeat e Cron tem papeis diferentes: heartbeat avalia estado e decide agir; cron define quando executar algo.
   - Sessao conversa em cima de `sessionKey`/`sessionId` com persistencia em store + transcript.
   - O runner do PI, no modo embedded, roda no mesmo processo; backends CLI podem executar em processo filho.
   - **Arquitetura single-process**: Gateway roda como unico processo Node.js unificando HTTP/WS + channels + cron + heartbeat + agent runtime.
   - Lock do gateway evita multiplos processos no mesmo config (hash do configPath).
   - Loop `while(true)` com SIGUSR1 permite hot-reload sem supervisor, mas é complexidade desnecessária para MVP.
- Recomeco da proxima sessao (ponto exato):
   - Decidir próxima fase do estudo (heartbeat/cron em profundidade, health/observabilidade, ou autoconsciencia do agente).

## Registro das sessões

### 2026-02-17 - Sessão 1 (exploração ampla)

- Foco:
  - Levantamento arquitetural inicial do OpenClaw.
- O que estudamos:
  - Estrutura geral do repo e docs principais.
  - `AGENTS.md` raiz e AGENTS especificos.
  - Fluxo base CLI -> Gateway -> Agent runtime.
- Aprendizados-chave:
  - Gateway atua como plano de controle central.
  - Projeto usa bootstrap/contexto para orientar o agente no workspace.
  - Resiliência ja aparece em varias camadas do runtime.
- Proximos passos:
  - Entrar a fundo em confiabilidade (retry/failover/recovery) e heartbeat/cron.

### 2026-02-17 - Sessão 2 (recorte: confiabilidade + heartbeat/cron)

- Foco:
  - Reposicionar o plano para resiliência primeiro e remover temas fora de escopo agora.
- O que estudamos:
  - `retry` e `retry-policy` (Telegram/Discord com backoff/jitter).
  - `model-fallback` e `failover-error` (classificacao de erro e troca de modelo/perfil).
  - Recuperacao de erro no `agent-runner-execution` (context overflow, compaction failure, corrupcao de sessao, transient HTTP retry).
  - Heartbeat runner/wake/system-events.
  - Cron service/timer (persistencia, catch-up, timeout de job, backoff de erro, wake integration).
- Aprendizados-chave:
  - Heartbeat nao e "só ping": e um turn periodico no main session, com contrato de `HEARTBEAT_OK` e supressao de ruido.
  - Cron e o scheduler preciso e persistente do Gateway (`~/.openclaw/cron/jobs.json`), inclusive com recuperacao apos restart.
  - Main cron job pode enfileirar evento e acordar heartbeat imediatamente.
  - Isolated cron job tem entrega controlada e evita duplicacao/ruido.
  - O runtime tem estrategias explicitas para insistir com seguranca sem entrar em loop cego.
- Proximos passos:
  - Produzir matriz "falha -> mecanismo de recuperacao -> arquivo".
  - Produzir guia pratico "quando usar heartbeat vs cron".
  - Definir checklist de validacao de confiabilidade para cada mudanca futura.

### 2026-02-18 - Sessão 3 (item 1: ciclo de vida do agente)

- Foco:
  - Mapear o fluxo real: `mensagem -> sessao -> plano -> acao -> persistencia`.
- O que estudamos:
  - Entrada por canais (`dispatchInboundMessage`) e por Gateway (`chat.send` / `agent`).
  - Resolucao/criacao de sessao com `sessionKey`, `sessionId`, reset policy e `sessionFile`.
  - Planejamento operacional via diretivas/comandos + montagem de prompt/snapshot de skills.
  - Execucao do turno no runner Pi embedded (ferramentas, stream, retries/fallbacks).
  - Persistencia de transcript e metadados de sessao (tokens, modelo, compaction, status).
- Aprendizados-chave:
  - Nao existe um "planner service" isolado: o "plano" e composto por duas camadas:
    - camada deterministica (diretivas/comandos/routing)
    - camada emergente do LLM durante uso de tools.
  - A resiliência fica concentrada no loop de execucao (`runAgentTurnWithFallback` + runner embedded):
    retries, fallback de modelo/perfil, auto-compaction e reset de sessao quando necessario.
  - A consistencia do historico depende de `SessionManager` (evita quebrar cadeia de parent/leaf).
- Arquivos-chave:
  - `src/auto-reply/reply/get-reply.ts`
  - `src/auto-reply/reply/session.ts`
  - `src/auto-reply/reply/get-reply-run.ts`
  - `src/auto-reply/reply/agent-runner.ts`
  - `src/auto-reply/reply/agent-runner-execution.ts`
  - `src/agents/pi-embedded-runner/run.ts`
  - `src/agents/pi-embedded-runner/run/attempt.ts`
  - `src/auto-reply/reply/session-usage.ts`
  - `src/gateway/server-methods/chat.ts`
  - `src/gateway/server-methods/agent.ts`

### 2026-02-18 - Sessão 4 (esclarecimentos conceituais: gateway/channels/api/runner)

- Foco:
  - Tirar ambiguidades de arquitetura para nao misturar conceitos no estudo.
- O que estudamos:
  - Relacao entre Gateway e channels: channels ficam dentro do runtime do gateway e despacham internamente.
  - Papel de HTTP/WS do gateway: alem de canal interno, o gateway tambem expoe API/endpoint.
  - Diferenca pratica entre entrada por channel runtime vs entrada por webhook HTTP.
  - Confirmacao de execucao do PI no fluxo de mensagem: embedded in-process vs backend CLI em child process.
  - **Arquitetura single-process confirmada**: Gateway roda como unico processo Node.js unificando todos os componentes.
- Aprendizados-chave:
  - O gateway e plano de controle + plano de entrada/saida de mensagens.
  - "Ter API" e "ter gateway" aqui sao a mesma superficie operacional principal.
  - Para resiliencia, separar bem "orquestracao in-process" de "execucao externa por CLI" evita diagnostico errado.
  - Gateway NAO e CLI client de servico separado; Gateway E o proprio servico rodando no mesmo processo do CLI.
- Proximo passo:
  - Mapear (em tabela curta) os caminhos reais por canal e o ponto onde cada um entra no dispatch comum.

### 2026-02-18 - Sessão 5 (dispatch ponta a ponta + ciclo de vida de sessão)

- Foco:
  - Mapear fluxo completo: entrada por canal → dispatch → execução do agente.
  - Entender ciclo de vida de sessão: criação, reset, persistência e limpeza.
- O que estudamos:
  - Fluxo de dispatch completo do Telegram até `runEmbeddedPiAgent`.
  - Criação de sessão via `initSessionState` com `sessionId` gerado por `crypto.randomUUID()`.
  - Reset triggers (`/new`, `/reset`) e políticas de reset por canal/tipo de sessão.
  - Persistência de sessão via `updateSessionStore` e `SessionManager`.
  - Mecanismos de recuperação: compaction failure, context overflow, role ordering conflicts.
- Aprendizados-chave:
  - **Fluxo de dispatch completo (Telegram)**:
    1. `bot-handlers.ts` → `registerTelegramHandlers` recebe update do Telegram
    2. `bot-message.ts` → `createTelegramMessageProcessor` cria processador
    3. `bot-message-dispatch.ts` → `dispatchTelegramMessage` prepara contexto
    4. `provider-dispatcher.ts` → `dispatchReplyWithBufferedBlockDispatcher` cria dispatcher
    5. `dispatch.ts` → `dispatchInboundMessage` finaliza contexto
    6. `dispatch-from-config.ts` → `dispatchReplyFromConfig` aplica TTS e routing
    7. `get-reply.ts` → `getReplyFromConfig` resolve modelo e workspace
    8. `get-reply-run.ts` → `runPreparedReply` monta prompt e contexto
    9. `agent-runner.ts` → `runReplyAgent` gerencia queue e typing
    10. `agent-runner-execution.ts` → `runAgentTurnWithFallback` com retry/fallback
    11. `pi-embedded.ts` → `runEmbeddedPiAgent` executa o agente in-process
  - **Ciclo de vida de sessão**:
    - **Criação**: `initSessionState` em `session.ts` (linha 94)
      - Gera novo `sessionId` via `crypto.randomUUID()` quando não existe entrada fresh
      - Resolve `sessionKey` baseado em scope (`per-sender`, `per-group`, etc.)
      - Cria `sessionFile` apontando para transcript JSONL
      - Persiste via `updateSessionStore` (linha 350)
    - **Reset triggers**: detectados em `session.ts` (linhas 170-194)
      - Triggers padrão: `/new`, `/reset`
      - Verifica autorização antes de resetar
      - Cria novo `sessionId` e limpa estado de compaction
      - Preserva overrides de modelo/provider/thinking
    - **Persistência**: `updateSessionStore` em `config/sessions.ts`
      - Store JSON em `~/.openclaw/sessions/<agentId>/sessions.json`
      - Transcript JSONL em `~/.openclaw/sessions/<agentId>/<sessionId>.jsonl`
      - Atualiza `updatedAt`, `totalTokens`, `compactionCount`, etc.
    - **Limpeza/Reset**: em `agent-runner-execution.ts` (linhas 235-294, 540-582)
      - Compaction failure → reset session + retry
      - Context overflow → reset session + mensagem ao usuário
      - Role ordering conflict → reset session + delete transcript
      - Session corruption (Gemini) → delete transcript + remove from store
  - **Mecanismos de resiliência no dispatch**:
    - Retry transiente HTTP (linha 584): aguarda 2.5s e tenta novamente
    - Model failover: `runWithModelFallback` tenta provider/model alternativo
    - Auto-compaction: detecta overflow e compacta histórico automaticamente
    - Session reset: em caso de falha irrecuperável, cria nova sessão e informa usuário
- Arquivos-chave:
  - Dispatch: `bot-handlers.ts`, `bot-message-dispatch.ts`, `dispatch-from-config.ts`, `get-reply.ts`, `get-reply-run.ts`, `agent-runner.ts`, `agent-runner-execution.ts`
  - Session: `session.ts`, `config/sessions.ts`, `pi-embedded.ts`
- Proximos passos:
  - Criar diagrama de fluxo completo (entrada → dispatch → execução → resposta).
  - Mapear tabela de canais (Telegram, Signal, Slack, etc.) e seus pontos de entrada.
  - Documentar políticas de reset por tipo de sessão (DM, group, thread).

### 2026-02-18 - Sessão 6 (arquitetura single-process do Gateway)

- Foco:
  - Entender como o Gateway é executado: CLI vs daemon vs processo único.
  - Mapear fluxo de inicialização do servidor HTTP/WS.
  - Avaliar trade-offs da arquitetura single-process.
- O que estudamos:
  - Fluxo de inicialização: `scripts/run-node.mjs` → `openclaw.mjs` → `src/index.ts` → CLI → `gateway run` → `startGatewayServer`.
  - Entry point do servidor: `src/gateway/server.impl.ts:155` (`startGatewayServer`).
  - Runtime state em `src/gateway/server-runtime-state.ts:29` → cria HTTP/WS servers via `createGatewayRuntimeState`.
  - Listen HTTP em `src/gateway/server/http-listen.ts:22` → `httpServer.listen(port, bindHost)`.
  - Loop de execução em `src/cli/gateway-cli/run-loop.ts:114-122` → `while(true)` reinicia servidor in-process via SIGUSR1.
- Aprendizados-chave:
  - **CLI vs Gateway não é client/servidor separado**:
    - `openclaw gateway run` inicia o próprio processo Node que se torna o servidor.
    - Não é CLI chamando API/container externo (como em Docker/K8s).
    - O daemon (`gateway install/start/stop`) apenas automatiza execução do `openclaw gateway run` via launchd/systemd.
  - **Single-process com módulos integrados**:
    - Gateway server (HTTP/WS + API methods)
    - Channels runtime (Telegram/Signal/Slack/etc.)
    - Agent runtime (PI embedded)
    - Cron service (agendamento)
    - Heartbeat runner (autonomia operacional)
    - Todos se comunicam via dispatch interno, WebSocket methods, event system/hooks.
  - **Por que single-process?**
    - Necessidade funcional: agente AI precisa de acesso irrestrito à máquina local (executar comandos, ler/escrever arquivos, acessar microfone, GPU, etc.).
    - Container/API separada limitaria: volume mounts, device passthrough, permissões granulares.
    - Similar a: Home Assistant, Ollama local, Plex server.
  - **Vantagens do approach**:
    - Deploy ultra simples: `openclaw gateway run`
    - Performance: zero overhead de IPC/network
    - Debugging: logs unificados, call stacks limpos
    - State sharing: memória compartilhada direta
   - **Desvantagens/Riscos**:
     - Single point of failure: crash = tudo para
     - Isolation limitada: bug num channel pode derrubar gateway
     - Restart in-process (SIGUSR1): se bug na limpeza, pode acumular estado entre restarts
   - **Lock do gateway** (`src/infra/gateway-lock.ts:176`):
     - Arquivo: `~/.openclaw/state/locks/gateway.{hash}.lock` (hash do configPath)
     - Payload: `{ pid, createdAt, configPath, startTime (Linux) }`
     - Aquisição: `fs.open(path, 'wx')` com timeout 5s, polling 100ms
     - Se `EEXIST`: valida PID vivo (Linux: `startTime` + `cmdline`), se dead → remove e tenta de novo
     - Liberação: cleanup no `finally` do `runGatewayLoop`
     - Exceções: `OPENCLAW_ALLOW_MULTI_GATEWAY=1` ou ambiente de teste
     - **Para MVP do nosso projeto**: lock simples (`EEXIST` → erro) é suficiente; skip validação PID, stale timeout, multi-config
 - Arquivos-chave:
   - Boot: `scripts/run-node.mjs`, `openclaw.mjs`, `src/index.ts`
   - CLI Gateway: `src/cli/gateway-cli/register.ts`, `src/cli/gateway-cli/run.ts`, `src/cli/gateway-cli/run-loop.ts`
   - Server: `src/gateway/server.impl.ts`, `src/gateway/server-runtime-state.ts`, `src/gateway/server/http-listen.ts`
   - Gateway methods: `src/gateway/server-methods/` (chat, agent, health, cron, etc.)
   - Lock: `src/infra/gateway-lock.ts`
   - Restart: `src/infra/restart.ts`, `src/infra/gateway-lock.ts`

### 2026-02-18 - Sessão 7 (mecanismo de restart in-process)

 - Foco:
   - Entender como o `while(true)` do `run-loop.ts` funciona.
   - Entender papel de SIGUSR1 e hot-reload sem supervisor.
 - O que estudamos:
   - **Loop `while(true)`** (`src/cli/gateway-cli/run-loop.ts:117-122`):
     ```typescript
     while (true) {
       server = await params.start();                    // Inicia servidor
       await new Promise<void>((resolve) => {          // Bloqueia aqui
         restartResolver = resolve;
       });
     }
     ```
     - Primeira iteração: inicia servidor e bloqueia na Promise
     - Enquanto roda: servidor responde mensagens, loop fica parado
     - Restart: `restartResolver()` resolve Promise → volta para início → reinicia servidor
     - Stop: não resolve Promise → `exit(0)` mata processo
   - **Fluxo de restart via SIGUSR1**:
     1. SIGUSR1 chega → `onSigusr1:97` → `request("restart", ...)`
     2. `request:54-66` → drena tasks ativas (espera 30s)
     3. `server.close:69-72` → fecha HTTP/WS servers
     4. `restartResolver():80` → resolve Promise → loop volta para início
     5. `shuttingDown = false:79` → reset para próxima iteração
   - **SIGUSR1 explicado**:
     - Sinal definido pelo usuário 1 (Unix)
     - Uso customizado pelo app (OpenClaw: restart in-process)
     - Alternativas: `SIGTERM` (stop), `SIGINT` (Ctrl+C), `SIGKILL` (kill sem cleanup)
     - Vantagem: sem overhead de spawn de novo processo
   - **Avaliação para nosso MVP**:
     - **Não implementar para MVP**: complexidade desnecessária, bug loop, debugging difícil
     - **Opção 1 - Supervisor**: systemd/launchd/docker/pm2 cuida do processo
     - **Opção 2 - Zero hot-reload**: stop → start para mudar config
     - **Opção 3 - Arquivo de comando**: `/watch/config.lock` (middle ground)
     - SIGUSR1 é otimização prematura; começar simples, evoluir depois
  - Arquivos-chave:
    - Loop: `src/cli/gateway-cli/run-loop.ts`
    - Restart: `src/infra/restart.ts`

### 2026-02-18 - Sessão 8 (diagrama: local vs gateway)

- Foco:
  - Criar documentação visual da diferença entre modo local e via Gateway.
  - Mapear onde os fluxos convergem (PI Agent compartilhado).
- O que estudamos:
  - Entry point diferente: `agent.ts` vs `agent-via-gateway.ts` → `callGateway`.
  - Modo local: executa direto, sem WebSocket, sem channels.
  - Modo gateway: WebSocket → Gateway → dispatch → mesmo PI Agent embedded.
  - Ponto de convergência: `runEmbeddedPiAgent` em `src/agents/pi-embedded-runner/run.ts`.
  - Código compartilhado: model fallback, skills snapshot, session store, auth profiles.
  - Divergência: channels, cron, heartbeat só existem via Gateway.
- Aprendizados-chave:
  - **PI Agent é o coração compartilhado**: ambos os fluxos usam `runEmbeddedPiAgent`.
  - Gateway adiciona camada de orquestração (channels, cron, heartbeat) em cima do mesmo core.
  - Local é para debug/teste rápido; Gateway é arquitetura de produção.
  - Para novo projeto: focar apenas Gateway fluxo, local é feature secundária.
  - Arquivo criado:
  - `local-vs-gateway-flow.md` - diagramas Mermaid + tabela de diferenças.
  - `gateway-send-flow.md` - fluxo completo de envio via Gateway (9 fases).
- Aprendizados-chave:
  - **Fluxo Gateway completo**: CLI → WebSocket → Gateway → Dispatch → PI Agent → Response
  - **9 fases identificadas**:
    1. CLI → Gateway Client (call.ts:156)
    2. Gateway Server - Recepção (agent.ts:46)
    3. Validação + Dedupe
    4. Session resolve
    5. Send accepted
    6. Execute agentCommand
    7. Dispatch (get-reply → agent-runner → execution)
    8. PI Agent embedded (API call real)
    9. Gateway response → CLI
  - **Conceitos-chave**:
    - Idempotency: `context.dedupe` evita re-execução
    - Dedupe: cached response com {cached: true}
    - Session context: `registerAgentRunContext` para tool events cross-session
    - Model fallback: loop de provider/model alternativo
  - **WebSocket frames**: 3 frames por request (request → accepted → final)
  - **Timing**: ~650-900ms do CLI até resposta (API call real domina)
  - **Mesmo código compartilhado**: `runEmbeddedPiAgent` em ambos fluxos
- Próximo passo:
  - Decidir se nova arquitetura começa com fluxo único (Gateway-only) ou se mantém ambos.




## Perguntas já respondidas (para referência rápida)

- "Heartbeat serve para chamar o usuario?":
  - Sim. Se houver algo relevante, o heartbeat envia alerta para o alvo configurado (`target`/`to`).
  - Se nao houver nada relevante, a resposta `HEARTBEAT_OK` e tratada como ack e normalmente suprimida.
- "Cron chama ele mesmo de tempos em tempos?":
  - Sim. Cron agenda execucao por horario exato (`at`, `every`, `cron`) e pode acordar heartbeat com `wakeMode`.
  - Para lembrete no contexto principal: `sessionTarget=main` + `systemEvent`.
  - Para tarefa isolada: `sessionTarget=isolated` + `agentTurn`.
- "O gateway e um processo separado do CLI?":
  - Nao. `openclaw gateway run` inicia um unico processo Node.js que roda: HTTP server + WS server + channels + cron + heartbeat + agent runtime.
  - CLI e Gateway fazem parte do mesmo processo (single-process).
  - Daemon (`gateway install/start`) apenas automatiza execucao do `openclaw gateway run` via launchd/systemd.
- "Entry point do Gateway?":
  - Funcao `startGatewayServer` em `src/gateway/server.impl.ts:155`.
  - HTTP listen via `httpServer.listen(port, bindHost)` em `src/gateway/server/http-listen.ts:22`.
 - "Por que single-process e nao CLI + API separada?":
   - Necessidade funcional: agente AI precisa de acesso irrestrito a maquina local (commands, arquivos, microfone, GPU).
   - Container/API separada limitaria acesso e adicionaria complexidade (volumes, permissoes, device passthrough).
   - Similar a: Home Assistant, Ollama local, Plex server.
 - "Como funciona o while(true) do run-loop?":
   - Loop infinito que inicia servidor e bloqueia em Promise até `restartResolver()` ser chamado.
   - SIGUSR1 chama `restartResolver()` → Promise resolve → loop volta para início → servidor reinicia.
   - SIGTERM/SIGINT não chamam `restartResolver()` → `exit(0)` mata processo.
 - "O que e SIGUSR1?":
   - Sinal Unix customizável (User Signal 1).
   - OpenClaw usa para restart in-process sem supervisor.
   - Alternativas: supervisor (systemd/launchd) ou stop/start manual.
  - "Lock do gateway e necessario para MVP?":
    - Lock simples (`EEXIST` → erro) é suficiente para MVP.
    - Over-engineering do OpenClaw: validação PID, stale timeout, multi-config.

### 2026-02-18 - Sessão 9 (decisão de arquitetura inicial)

- Foco:
  - Definir se começa com auto-reply completo ou Gateway → PI Agent direto.
- O que estudamos:
  - Fluxo completo de envio via Gateway (9 fases mapeadas).
  - Auto-reply layer = 20+ arquivos, 2000+ linhas.
  - Features complexas do OpenClaw: multi-channel, skills, typing, followup, groups, threads, media/TTS.
  - Resiliência built-in: model fallback, context window guard, session reset/compaction.
  - Arquitetura single-process confirmada: Gateway roda tudo num processo Node.js.
- Decisão para nova arquitetura:
  - **NÃO criar auto-reply completo para MVP inicial**.
  - Começar com **Gateway → PI Agent direto** (simples).
  - MVP ultra-simples: WebSocket message → runEmbeddedPiAgent → persist session → return response.
  - O que NÃO inclui:
    - ❌ Auto-reply complexo (resolve de workspace, directives, skills)
    - ❌ Multi-channel (Telegram/Signal/Slack/etc.)
    - ❌ Skills (workspace scan, templates, snapshots)
    - ❌ Typing indicators (cross-session signaling)
    - ❌ Followup (mensagens sequenciais)
    - ❌ Multi-session (groups, threads)
    - ❌ Link/media understanding
    - ❌ Reply directives (@user, threads)
    - ❌ Block reply pipeline (voice/TTS)
    - ❌ Context window guard avançado
  - O que INCLUI (essencial):
    - ✅ WebSocket server (ws://127.0.0.1:porta)
    - ✅ Message handler simples
    - ✅ Session storage básica (JSONL + store)
    - ✅ runEmbeddedPiAgent (PI Agent embedded)
    - ✅ Model fallback (runWithModelFallback)
    - ✅ Context window básico
    - ✅ Tool execution (se necessário)
    - ✅ Persistência de transcript
- Quando evoluir para features complexas:
  1. Auto-reply layer (se precisar de múltiplos canais)
  2. Skills (templates, workspace scan)
  3. Multi-session (groups, threads)
  4. Features de UX (typing, followup)
  5. Link/media understanding
- Arquivos-chave:
  - `gateway-send-flow.md` - fluxo completo de envio via Gateway.
  - `local-vs-gateway-flow.md` - comparação local vs gateway.
- Aprendizados-chave:
  - **Gateway é ponto de entrada único**: tudo entra por WebSocket.
  - **PI Agent é coração compartilhado**: tanto via gateway quanto local usam `runEmbeddedPiAgent`.
  - **Auto-reply é orquestração de produção**: resolve edge cases, mas é overkill para MVP.
  - **MVP deve ser ultra-simples**: Gateway → PI Agent → Response.
  - **Princípio de evolução**: comece simples, adicione complexidade gradualmente conforme necessidade.
  - Próximo passo:
  - Começar desenho da arquitetura inicial (Gateway-only, sem auto-reply).
  - Consultar `openclaw-interesting-patterns.md` para os 8 aspectos mais valiosos.

### 2026-02-18 - Sessão 10 (atualização dos arquivos de projeto)

- Foco:
  - Atualizar PROJECT-VISION.md e AGENT-DEV-GUIDE.md baseado no estudo do OpenClaw.
  - Remover referências específicas do Kael (vídeo processing, investimentos) e substituir por padrões do OpenClaw.
  - Adaptar documentos para contexto de [NOME_DO_PROJETO] como referência.
- O que estudamos/atualizamos:
  - Atualizamos PROJECT-VISION.md:
    - Substituímos referências do Kael por [NOME_DO_PROJETO] e por [ÁREAS FUTURAS]
    - Removemos especializações de vídeo e investimentos
    - Substituímos stack tecnológica por padrões do OpenClaw (Fastify, WS plugin, JSONL, etc.)
    - Atualizamos Roadmap para ser baseado em fases do OpenClaw (MVP, Skills, Resiliência, Channels)
    - Adicionamos arquitetura de referência (gateway single-process)
    - Adicionamos tabela de conceitos-chave do OpenClaw
  - Atualizamos AGENT-DEV-GUIDE.md:
    - Criamos guia completo usando OpenClaw como referência técnica
    - Organizamos por conceitos-chave (Gateway, Sessions, PI Agent, Resiliência, etc.)
    - Adicionamos roadmap de implementação em fases
    - Incluímos lista de arquivos-chave do OpenClaw para estudar
    - Adicionamos boas práticas baseadas no estudo
    - Adicionamos seção "Diferenças vs OpenClaw" para focar no que é relevante
- Arquivos atualizados:
  - `PROJECT-VISION.md` - visão geral, stack sugerida, roadmap baseado em OpenClaw
  - `AGENT-DEV-GUIDE.md` - guia completo de desenvolvimento
- Aprendizados-chave:
  - **Gateway single-process**: unifica Gateway + Agent + Cron + Heartbeat em um processo.
  - **Session management**: sessionKey/sessionId/JSONL transcripts (padrão OpenClaw).
  - **PI Agent embedded**: wrapper com tools básicos (exec, fs) e resiliência.
  - **WebSocket dedupe**: idempotency via `context.dedupe` evita re-execução.
  - **Model fallback classificado**: entende erro e escolhe alternativa apropriada.
  - **Context window guard**: proteção proativa antes de chamar API.
  - **Cron persistente**: jobs em JSON com catch-up após restart.
  - **Referência técnica**: OpenClaw como implementação battle-tested de padrões.
  - **Diferenças**: documentado o que NÃO copiar do OpenClaw (multi-channel, skills complexas).
- Próximo passo:
  - Desenvolver seguindo o guia AGENT-DEV-GUIDE.md.
  - Começar pela Fase 1 (Core Gateway + PI Agent básico + Sessions).
  - Consultar os arquivos-chave do OpenClaw listados em AGENT-DEV-GUIDE.md para patterns concretos.
  - Usar study.md como registro do que já aprendemos.


## Checklist de evolução contínua

- [ ] Atualizar este arquivo ao fim de cada sessão.
- [ ] Manter matriz de falhas e recuperacoes por camada.
- [ ] Registrar regressao/incidente e o teste que previne repeticao.
- [ ] Revisar se a mudança preserva confiabilidade antes de ampliar escopo.
