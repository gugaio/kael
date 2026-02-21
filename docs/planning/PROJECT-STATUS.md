# PROJECT STATUS - Kael

Ultima atualizacao: **2026-02-21**
Owner: projeto Kael

## Como usar este arquivo

1. Atualize em todo commit funcional.
2. Marque fase, entregas, pendencias e proximo passo.
3. Mantenha este arquivo curto e objetivo.

## Template rapido para novo commit

Copie o bloco abaixo ao registrar um novo commit em "Registro de Atualizacoes por Commit":

```md
### YYYY-MM-DD - <titulo curto do commit>

Resumo:
- <entrega 1>
- <entrega 2>

Arquivos-chave:
- `<arquivo 1>`
- `<arquivo 2>`

Checklist de validacao:
- [ ] `npm run check`
- [ ] teste manual do fluxo principal da fase

Pendencias:
- <pendencia 1>

Proximo passo recomendado:
- <proximo passo>
```

## Roadmap de Fases

### Fase 0 - Foundation

Status: **Concluida**

Entregas:
- Estrutura inicial em TypeScript/Node.
- Config central (`KAEL_PORT`, `KAEL_HOST`, `KAEL_DATA_DIR`).
- App bootstrap com composicao de servicos.

Definition of Done (checklist):
- [x] Projeto sobe localmente via CLI/API.
- [x] Typecheck configurado em modo strict.
- [x] Estrutura de pastas base definida.
- [x] Configuracao centralizada por env.

### Fase 1 - Core Loop (CLI + API + Session + Job Basico)

Status: **Concluida**

Entregas:
- API Fastify:
  - `GET /health`
  - `POST /chat`
  - `GET /sessions/:sessionKey/messages`
  - `POST /jobs/transcode`
  - `GET /jobs`
  - `GET /jobs/:jobId`
  - `GET /jobs/:jobId/log`
- CLI:
  - `server`
  - `chat --message`
  - `jobs`
- Session Store:
  - index em JSON
  - transcript append-only em JSONL por sessao
- Job Store:
  - persistencia de jobs em JSON
  - logs por job em arquivo dedicado
- Tooling:
  - `ProcessRunner` (abstracao)
  - `LocalProcessRunner` (execucao local)
  - `TranscodeService` assíncrono com ffmpeg
- Engine:
  - interface `AgentEngine`
  - implementacao inicial `SimpleCommandEngine`

Pendencias desta fase:
- Sem dedupe/idempotency ainda.
- Sem retries/backoff ainda.
- Sem testes automatizados ainda.

Definition of Done (checklist):
- [x] Endpoint de chat funcional (`POST /chat`).
- [x] Sessao persistida com transcript JSONL.
- [x] CLI operacional para chat e jobs.
- [x] Job assíncrono de transcode com log persistente.
- [x] Contrato de engine desacoplado (`AgentEngine`).
- [ ] Testes automatizados desta fase.

### Fase 2 - Engine Real + Tooling de Video

Status: **Em andamento**

Objetivos:
- Criar `PiEngineAdapter` (ou adapter equivalente).
- Manter fallback local para comandos basicos.
- Expandir tools de video:
  - `convertHLS`
  - `captureStream`
  - `probeMedia`

Definition of Done (checklist):
- [x] `PiEngineAdapter` integrado ao contrato `AgentEngine`.
- [x] `SimpleCommandEngine` mantido como fallback operacional.
- [x] `convertHLS` implementado e testado manualmente.
- [x] `captureStream` implementado e testado manualmente.
- [x] `probeMedia` implementado e testado manualmente.
- [x] Atualizacao de docs de uso de tools no README/STATUS.
- [ ] Adicionar testes automatizados para as novas tools.

### Fase 3 - Resiliencia Operacional

Status: **Concluida**

Objetivos:
- Retry com backoff + jitter.
- Classificacao de erro e fallback de modelo.
- Guard de contexto e reset de sessao em falhas irrecoveraveis.
- Dedupe/idempotency para requests.

Definition of Done (checklist):
- [x] Retry utilitario com politicas configuraveis.
- [x] Fallback classificado por tipo de erro.
- [x] Guard de contexto aplicado antes de chamada de modelo.
- [x] Reset automatico de sessao para falhas fatais.
- [x] Dedupe/idempotency ativo nos endpoints criticos.

### Fase 4 - Autonomia (Heartbeat + Cron)

Status: **Concluida**

Objetivos:
- Heartbeat produtivo (nao so ACK).
- Scheduler cron persistente com catch-up.
- Notificacao de mudancas relevantes de jobs.

Definition of Done (checklist):
- [x] Heartbeat executando em intervalo configuravel.
- [x] Resposta silenciosa quando nao houver acao.
- [x] Cron persistente com recuperacao apos restart.
- [x] Monitoramento de jobs com notificacoes relevantes.
- [x] API/CLI para listar e gerenciar schedules.
- [x] Suporte inicial a cron expression para schedules.

### Fase 5 - Hardening e Observabilidade

Status: **Concluida**

Objetivos:
- Testes (unit/integration/e2e).
- Logs estruturados e health mais rico.
- Politicas de seguranca de execucao.

Definition of Done (checklist):
- [ ] Suite minima de testes unitarios para stores/engine/jobs.
- [x] Testes de integracao de API (chat + jobs).
- [x] Logs estruturados com contexto de sessao/job.
- [x] Health endpoint com sinais operacionais.
- [x] Politica de execucao segura documentada e aplicada.

### Fase 6 - Shell Power no PI (exec/process + approvals)

Status: **Concluida**

Objetivos:
- Dar capacidade real de shell para o Kael em `pi`/`hybrid`.
- Permitir controle de processos em background (`list/poll/kill`).
- Aplicar politica de seguranca e aprovacao persistida em `~/.kael`.

Definition of Done (checklist):
- [x] Tool `exec` integrada ao PI.
- [x] Tool `process` integrada ao PI.
- [x] Timeout + limite de output + `cwd` restrito ao workspace.
- [x] Politica `deny|allowlist|full` e `ask=off|on-miss|always`.
- [x] Persistencia de approvals em `~/.kael/exec-approvals.json`.
- [x] Testes unitarios de policy/approvals.

### Fase 7 - Guardrails de Loop (exec/process)

Status: **Concluida**

Objetivos:
- Evitar loops de tool calling sem progresso em `exec` e `process`.
- Reduzir custo e latencia em fluxos com polling/repeticao.

Definition of Done (checklist):
- [x] Detector de repeticao/no-progress no runtime PI.
- [x] Bloqueio temporario com cooldown e mensagem explicita para o agente.
- [x] Testes unitarios cobrindo bloqueio e casos de progresso.
- [x] Context guard com auto-compaction de historico antes de estourar contexto.
- [ ] Tuning de thresholds e qualidade de resumo com telemetria real de uso.

### Fase 8 - Memoria Operacional (longo prazo)

Status: **Em andamento**

Objetivos:
- Dar memoria persistente local ao Kael para fatos, preferencias e decisoes.
- Expor ferramentas explicitas de recall/escrita para o PI.

Definition of Done (checklist):
- [x] Persistencia em `MEMORY.md` (duravel) e `memory/YYYY-MM-DD.md` (diaria).
- [x] Tools `memory_search`, `memory_get` e `memory_write` integradas ao PI.
- [x] Leitura restrita de memoria para paths permitidos.
- [x] Testes unitarios de escrita, busca e seguranca de path.
- [x] Planner/executor baseline com plano persistido e tools de plano no PI.
- [x] Planner inteligente inicial com `plan_generate` (objetivo -> plano heuristico).
- [x] Checkpoints por etapa no planner (historico de transicoes + notas acumuladas).
- [x] Executor assistido (`plan_execute_next`) com vinculo de step para `job/exec`.
- [ ] Tuning de ranking/recencia e qualidade de snippets.
- [ ] Reconciliacao automatica de estado (fechar step quando `job/exec` terminar).

## Registro de Atualizacoes por Commit

### 2026-02-21 - Fase 8.1: planner/executor baseline (plano persistido)

Resumo:
- Implementado `PlannerService` com persistencia local em `plans/plans.json`.
- Integradas tools de plano no PI: `plan_create`, `plan_list`, `plan_update_step`, `plan_next`.
- Expostos endpoints HTTP de planos (`GET/POST /plans`, `GET /plans/:planId`, `POST /plans/:planId/steps/:stepIndex`).
- Ajustada derivacao de status para preservar `canceled` quando todas as etapas forem canceladas.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/engine/pi-tools.ts`
- `src/api/server.ts`
- `docs/architecture/phases/phase-8.1.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Explicar ao PI quando abrir/atualizar plano automaticamente (heuristica inicial).

Proximo passo recomendado:
- Fase 8.2: planner inteligente com checkpoints por execucao e notas de progresso.

### 2026-02-20 - Fase 6: shell tools no PI (exec/process)

Resumo:
- Implementado `ShellToolService` com execucao local de shell, timeout, background e gerenciamento de sessoes.
- Integradas tools `exec` e `process` no `PiEngineAdapter`.
- Implementado `ExecApprovalStore` com politica `security/ask`, allowlist e pendencias em `~/.kael/exec-approvals.json`.
- Expandida configuracao (`KAEL_EXEC_*`) e defaults globais em `~/.kael/config.json`.

Arquivos-chave:
- `src/tools/system/shell-tool-service.ts`
- `src/tools/system/shell-approvals.ts`
- `src/engine/pi-tools.ts`
- `src/engine/pi-engine-adapter.ts`
- `src/config.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Streaming realtime de output (SSE/WebSocket) para substituir polling em parte dos fluxos.

Proximo passo recomendado:
- Fase 7: UX operacional de approvals + stream de eventos/processos.

### 2026-02-20 - Fase 6.1: approvals end-to-end (API + CLI + UI)

Resumo:
- Fechado fluxo de aprovacao manual: listagem, approve e deny via API.
- `exec` passou a aguardar decisao manual por janela configuravel (`KAEL_EXEC_APPROVAL_WAIT_MS`) antes de concluir.
- CLI ganhou comandos para operar approvals sem editar arquivo JSON.
- UI `Ops` ganhou painel de approvals pendentes com acoes de `Approve`/`Deny`.
- Prompt de tools ajustado para orientar uso de `process kill` antes de `exec kill`.

Arquivos-chave:
- `src/tools/system/shell-approvals.ts`
- `src/tools/system/shell-tool-service.ts`
- `src/api/server.ts`
- `src/cli/index.ts`
- `ui/src/pages/OpsPage.tsx`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`
- [x] `npm run ui:check`

Pendencias:
- SSE/WebSocket para eventos de approvals/processos e menor latencia de atualizacao.

Proximo passo recomendado:
- Fase 7: stream realtime de eventos (`/events/stream`) e log follow para jobs/processos.

### 2026-02-20 - Fase 6.2: hardening de approvals/policy (staff pass)

Resumo:
- Policy de allowlist endurecida: bloqueio explicito de sintaxe shell avancada em `security=allowlist`.
- `exec-approvals.json` com escrita atomica e lock para reduzir risco de corrida.
- Novos testes de fluxo completo no `ShellToolService` (approve/deny com espera real de decisao).

Arquivos-chave:
- `src/tools/system/shell-approvals.ts`
- `src/tools/system/shell-tool-service.ts`
- `src/tools/system/shell-approvals.test.ts`
- `src/tools/system/shell-tool-service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Stream realtime (SSE/WebSocket) para reduzir polling de approvals/processos.

Proximo passo recomendado:
- Fase 7: `/events/stream` + log follow realtime.

### 2026-02-20 - Fase 7.0: loop detection para tools de shell

Resumo:
- Implementado `ToolLoopGuard` para detectar repeticao de chamadas `exec/process` sem progresso.
- Integrado no fluxo de tools PI com bloqueio temporario (`cooldown`) e retorno estruturado (`blocked`, `reason`, `retryAfterMs`).
- Cobertura inicial por testes unitarios validando: bloqueio por repeticao, nao bloqueio quando ha progresso e isolamento por sessao/tool.

Arquivos-chave:
- `src/engine/tool-loop-guard.ts`
- `src/engine/tool-loop-guard.test.ts`
- `src/engine/pi-tools.ts`
- `src/engine/pi-engine-adapter.ts`
- `docs/architecture/phases/phase-7.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Calibrar thresholds com feedback de uso real e logs.

Proximo passo recomendado:
- Fase 7.1: context guard + auto-compaction (item 2).

### 2026-02-20 - Fase 7.1: context guard + auto-compaction

Resumo:
- Implementado guard de contexto no `TurnOrchestrator` para detectar crescimento excessivo de historico por mensagens/chars.
- Adicionada auto-compaction com resumo persistido em mensagem `system` (`[compaction]`) para reduzir pressao de contexto.
- Protecao contra compaction repetida em loop (nao compacta quando existe compaction recente na janela).
- Contexto enviado ao engine passou a aceitar `role=system` para carregar resumo compactado.

Arquivos-chave:
- `src/chat/turn-orchestrator.ts`
- `src/chat/turn-orchestrator.test.ts`
- `src/engine/types.ts`
- `docs/architecture/phases/phase-7.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Melhorar qualidade de resumo (hoje heuristico) e calibrar thresholds com telemetria.

Proximo passo recomendado:
- Fase 7.2: SSE de eventos/logs/lifecycle para UX realtime (item 3).

### 2026-02-20 - Fase 8.0: memoria operacional baseline

Resumo:
- Implementado `MemoryService` local-first com markdown como source-of-truth.
- Adicionada separacao de memoria por horizonte:
  - `MEMORY.md` para memoria de longo prazo;
  - `memory/YYYY-MM-DD.md` para memoria diaria.
- Integradas tools no PI:
  - `memory_search` (snippets com path/linhas),
  - `memory_get` (leitura segura),
  - `memory_write` (persistencia explicita daily/long_term).
- `memory_get` foi restringido a `MEMORY.md` e `memory/*.md` dentro do workspace.

Arquivos-chave:
- `src/memory/service.ts`
- `src/memory/service.test.ts`
- `src/engine/pi-tools.ts`
- `src/chat/service.ts`
- `src/app.ts`
- `docs/architecture/phases/phase-8.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Melhorar ranking de busca com recencia e reduzir snippets redundantes.

Proximo passo recomendado:
- Fase 8.1: planner/executor explicito com estado de plano persistido.

### 2026-02-19 - UI-1 (bootstrap): base frontend ops-first em `ui/`

Resumo:
- Criado projeto frontend dedicado em `ui/` com React + Vite + Tailwind.
- Navegacao inicial ops-first implementada (`Ops`, `Jobs`, `Schedules`, `Chat`, `Health`).
- Integracao com API atual via proxy `/api` e polling com TanStack Query.
- Base pronta para evoluir cards operacionais no chat e tempo real (SSE na UI-2).

Arquivos-chave:
- `ui/package.json`
- `ui/src/App.tsx`
- `ui/src/pages/OpsPage.tsx`
- `ui/src/pages/JobsPage.tsx`
- `ui/src/pages/JobDetailPage.tsx`
- `ui/src/pages/SchedulesPage.tsx`
- `ui/src/pages/ChatPage.tsx`
- `ui/src/pages/HealthPage.tsx`
- `ui/src/lib/api.ts`

Checklist de validacao:
- [ ] `npm --prefix ui install`
- [ ] `npm run ui:check`
- [ ] `npm run ui:dev` com backend ativo

Pendencias:
- Adicionar cards de job inline no chat.
- Refinar UX de erro/loading e estados vazios com mais contexto.

Proximo passo recomendado:
- Implementar cards operacionais no chat e acao rapida de abrir job/schedule relacionado.

### 2026-02-19 - UI governance: guia oficial da UI em docs

Resumo:
- Criado guia central da UI com visao ops-first, fases UI-0..UI-3 e checklist de atualizacao por commit.
- Documento desenhado para onboarding rapido de novas instancias de agente.

Arquivos-chave:
- `docs/ui/UI-GUIDE.md`
- `docs/core/START-HERE.md`
- `README.md`

Checklist de validacao:
- [x] Documento versionado em `docs`.
- [x] Referencias adicionadas no onboarding.

Pendencias:
- Iniciar implementacao da UI-1 (MVP operacional web).

Proximo passo recomendado:
- Criar base frontend da UI-1 com Ops Overview + Jobs.

### 2026-02-19 - Fase 5 (incremento): health enriquecido + guardrails de execucao

Resumo:
- `GET /health` evoluido com metricas operacionais de sessoes, jobs e schedules.
- Guardrails de seguranca para jobs de video (paths/URLs/args) com erro de validacao dedicado.
- Config de seguranca adicionada com env vars para roots permitidos e limite de args.
- Testes adicionados para safety e health.

Arquivos-chave:
- `src/tools/video/safety.ts`
- `src/tools/video/video-job-service.ts`
- `src/api/server.ts`
- `src/jobs/store.ts`
- `src/session/store.ts`
- `src/tools/video/safety.test.ts`
- `src/api/server.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Limite de concorrencia e timeout por tipo de job.
- Testes de integracao HTTP focados em falha de seguranca nas rotas `/jobs/*`.

Proximo passo recomendado:
- Implementar controle de concorrencia e budget de runtime por job.

### 2026-02-19 - Fase 5 (incremento): fila de execucao + timeout/cancelamento de jobs

Resumo:
- `VideoJobService` ganhou fila interna com semaforo de concorrencia.
- Jobs agora respeitam limite global de workers concorrentes.
- Timeout de execucao com cancelamento controlado (SIGTERM + grace + SIGKILL).
- Health passou a expor metricas de runtime (`activeJobs`, `queuedJobs`, `maxConcurrentJobs`).

Arquivos-chave:
- `src/tools/video/video-job-service.ts`
- `src/jobs/manager.ts`
- `src/api/server.ts`
- `src/config.ts`
- `src/tools/video/video-job-service.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/tools/video/video-job-service.test.ts src/api/server.test.ts src/config.test.ts`

Pendencias:
- Tornar concorrencia e timeout configuraveis por tipo de job.
- Expor cancelamento manual de job via API/CLI.

Proximo passo recomendado:
- Implementar endpoint/CLI de cancelamento de job e testes E2E de `/jobs/*`.

### 2026-02-19 - Fase 5 (incremento): cancelamento manual de jobs (API + CLI)

Resumo:
- Endpoint `POST /jobs/:jobId/cancel` adicionado para cancelar jobs em fila ou em execucao.
- CLI `job-cancel --id <jobId>` adicionada para operacao direta sem `curl`.
- Introduzido status de job `canceled` para representar cancelamento manual de forma explicita.
- Testes de runtime e integracao atualizados para fluxo de cancelamento.

Arquivos-chave:
- `src/tools/video/video-job-service.ts`
- `src/jobs/manager.ts`
- `src/api/server.ts`
- `src/cli/index.ts`
- `src/types.ts`
- `src/tools/video/video-job-service.test.ts`
- `src/api/server.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Expor motivo detalhado de cancelamento no contrato da API (manual x timeout).
- Adicionar cancelamento em lote por sessao (opcional).

Proximo passo recomendado:
- Cobrir E2E completo de `/jobs/*` incluindo validacao de seguranca e cancelamento.

### 2026-02-19 - Fase 5 (incremento): E2E `/jobs/*` (seguranca, timeout, cancelamento)

Resumo:
- Suite E2E dedicada de jobs adicionada com app real de `JobStore + VideoJobService + JobManager`.
- Cobertos cenarios ponta-a-ponta:
  - rejeicao por path inseguro
  - timeout de job com status `failed` e log com marcador de timeout
  - cancelamento de job queued e running com status final `canceled`

Arquivos-chave:
- `src/api/jobs.e2e.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Adicionar asserts E2E de idempotency para `POST /jobs/*`.
- Avaliar cenarios de concorrencia > 1 com multiplos tipos de job.

Proximo passo recomendado:
- Implementar retry/politica operacional por tipo de job (transcode, hls, capture, probe).

### 2026-02-19 - Fase 4.1 (hardening): contrato de erro, validacao de config e logs estruturados

Resumo:
- API padronizada com contrato unico de erro (`status`, `code`, `message`, `details`, `requestId`).
- Validacao de configuracao no startup com falha rapida para casos invalidos.
- Observabilidade inicial com logs JSON em `stdout` para requests HTTP e execucoes do scheduler.
- Testes de integracao HTTP para `/chat` (incluindo idempotency) e `/schedules`.

Arquivos-chave:
- `src/api/server.ts`
- `src/api/errors.ts`
- `src/infra/logger.ts`
- `src/config.ts`
- `src/api/server.test.ts`
- `src/config.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/api/server.test.ts src/config.test.ts src/automation/persistent-scheduler.test.ts`

Pendencias:
- Definir cobertura E2E de jobs (`/jobs/*`) com cenarios de erro reais.
- Expandir `code` de erro para dominio de negocio (quando necessario).

Proximo passo recomendado:
- Avancar para observabilidade expandida (metricas + health com sinais operacionais).

### 2026-02-19 - Fase 4 (incremento): API/CLI de schedules + cron expression

Resumo:
- Scheduler evoluido para dois tipos de agenda (`interval` e `cron`).
- Adicionadas rotas de schedules para listagem, detalhe, upsert, pause e resume.
- Adicionados comandos CLI para operar schedules sem `curl`.
- Incluidos testes focados de `cron` e `PersistentScheduler`.

Arquivos-chave:
- `src/automation/cron.ts`
- `src/automation/persistent-scheduler.ts`
- `src/automation/service.ts`
- `src/api/server.ts`
- `src/cli/index.ts`
- `src/automation/cron.test.ts`
- `src/automation/persistent-scheduler.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npx vitest run src/automation/cron.test.ts src/automation/persistent-scheduler.test.ts`

Pendencias:
- Expor operacoes de delete de schedule e execucao manual (`run-now`).
- Evoluir parser cron para ranges/listas se necessario.

Proximo passo recomendado:
- Iniciar Fase 5 com logs estruturados de turno/job e testes de integracao HTTP.

### 2026-02-18 - Fase 4 (incremento): heartbeat + scheduler persistente

Resumo:
- Implementado scheduler persistente com store JSON e tick configuravel.
- Adicionado catch-up basico apos restart para jobs atrasados.
- Criado `HeartbeatRunner` para monitorar mudancas de status de jobs.
- Heartbeat agora notifica a sessao com mensagem de sistema quando job muda para `succeeded`/`failed`.
- Integrado bootstrap automatico no app quando `KAEL_HEARTBEAT_ENABLED=true`.

Arquivos-chave:
- `src/automation/persistent-scheduler.ts`
- `src/automation/heartbeat-runner.ts`
- `src/app.ts`
- `src/config.ts`
- `src/global-config.ts`
- `docs/architecture/phases/phase-4.md`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual: iniciar servidor, rodar job e confirmar mensagem `[heartbeat]` na sessao

Pendencias:
- Evoluir scheduler de intervalo para cron expressions.
- Expor API/CLI de gerenciamento de schedules.

Proximo passo recomendado:
- Iniciar Fase 5 com observabilidade (logs estruturados de turno/job) e testes de integracao.

### 2026-02-18 - Fase 3 (incremento): reset automatico de sessao em falha fatal

Resumo:
- `SessionStore` ganhou operacao de reset por `sessionKey` com novo transcript.
- `ChatService` passou a detectar falhas fatais classificadas e executar reset automatico.
- Apos reset, o turno e reexecutado uma unica vez para recuperar o fluxo.
- Docs de Fase 3 atualizadas para refletir entrega.

Arquivos-chave:
- `src/session/store.ts`
- `src/chat/service.ts`
- `docs/architecture/phases/phase-3.md`
- `docs/planning/PROJECT-STATUS.md`

Checklist de validacao:
- [ ] `npm run check`
- [ ] teste manual de `/chat` simulando falha fatal para validar reset/retry unico

Pendencias:
- Evoluir idempotency store para persistente (se necessario).
- Adicionar resumo de contexto alem do truncamento por janela.

Proximo passo recomendado:
- Iniciar Fase 4 com heartbeat produtivo e scheduler cron persistente.

### 2026-02-18 - Simplificacao do runtime PI (SDK-only)

Resumo:
- Removidos caminhos `local_process` e `openai_http` para reduzir custo de manutencao.
- `PiEngineAdapter` agora opera exclusivamente com PI SDK embutido.
- Configuracao PI foi simplificada (sem `transport`, `apiUrl` e `local.command/args`).
- Documentacao atualizada com estrategia atual e nota para reintroducao futura se necessario.

Arquivos-chave:
- `src/engine/pi-engine-adapter.ts`
- `src/config.ts`
- `src/global-config.ts`
- `README.md`
- `docs/architecture/phases/phase-2.md`
- `docs/architecture/phases/phase-3.md`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual de `/chat` em `hybrid` confirmando fluxo PI normal

Pendencias:
- Se houver necessidade futura de multiplos transportes, reintroduzir via novo adapter dedicado (nao no caminho principal).

Proximo passo recomendado:
- Continuar Fase 3 com reset controlado de sessao + observabilidade de turnos.

### 2026-02-18 - Fase 3 (incremento): TurnOrchestrator + context guard multi-turn

Resumo:
- Introduzido `TurnOrchestrator` para centralizar preparacao de turnos antes da engine.
- Contexto conversacional agora entra no PI com janela limitada por mensagens e caracteres.
- `PiEngineAdapter` passou a receber historico recente (HTTP como mensagens; SDK/local-process como prompt serializado).

Arquivos-chave:
- `src/chat/turn-orchestrator.ts`
- `src/chat/service.ts`
- `src/engine/types.ts`
- `src/engine/pi-engine-adapter.ts`
- `src/config.ts`
- `src/global-config.ts`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual multi-turn (`/chat`) confirmando continuidade entre mensagens

Pendencias:
- Implementar reset automatico de sessao em falhas fatais.
- Evoluir de truncamento de contexto para resumo de contexto.

Proximo passo recomendado:
- Iniciar proximo incremento com `session reset controlado` + logs estruturados de turno (`turnId`, `fallbackReason`, `retryCount`).

### 2026-02-18 - Bootstrap inicial do projeto

Resumo:
- Implementado core funcional (Fase 0 + Fase 1).
- Corrigido typecheck do `ProcessRunner` (`stdio` com `pipe` para stdin/stdout/stderr).

Arquivos-chave:
- `src/api/server.ts`
- `src/cli/index.ts`
- `src/session/store.ts`
- `src/jobs/store.ts`
- `src/tools/video/transcode-service.ts`
- `src/engine/types.ts`
- `src/engine/simple-engine.ts`

Proximo passo recomendado:
- Iniciar Fase 2 com `PiEngineAdapter` mantendo o contrato de `AgentEngine`.

### 2026-02-18 - Fase 2: engine hibrida + tools de video

Resumo:
- Implementado `PiEngineAdapter` e factory de engine com modos `simple`, `pi` e `hybrid`.
- Expandido job runtime com `convert_hls`, `capture_stream` e `probe_media`.
- Expostos novos endpoints de jobs e atualizado comando `/help` com novas actions.

Arquivos-chave:
- `src/engine/pi-engine-adapter.ts`
- `src/engine/factory.ts`
- `src/engine/hybrid-engine.ts`
- `src/tools/video/video-job-service.ts`
- `src/api/server.ts`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual basico dos comandos slash no fluxo de chat

Pendencias:
- Adicionar testes automatizados da Fase 2.

Proximo passo recomendado:
- Iniciar Fase 3 com retry utilitario e camada de dedupe/idempotency.

### 2026-02-18 - CLI init e home global (~/.kael)

Resumo:
- Adicionado comando `kael init` para bootstrap de configuracao global.
- Implementado carregamento automatico de `~/.kael/config.json` com override por env.
- Criada base para home global com `data` e `logs`.

Arquivos-chave:
- `src/cli/index.ts`

### 2026-02-18 - Fase 3 (incremento): retry + fallback classificado + idempotency

Resumo:
- Implementado retry generico com backoff exponencial + jitter configuravel.
- `PiEngineAdapter` passou a classificar erros e aplicar retry apenas para falhas transientes.
- `HybridEngine` (via factory) agora usa fallback por classe de erro, sem catch generico.
- Rotas criticas ganharam idempotency via `x-idempotency-key` com TTL e resposta replay.

Arquivos-chave:
- `src/infra/retry.ts`
- `src/engine/pi-errors.ts`
- `src/engine/pi-engine-adapter.ts`
- `src/engine/factory.ts`
- `src/infra/idempotency-store.ts`
- `src/api/server.ts`
- `src/config.ts`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual de replay idempotente (`x-idempotency-key`) nas rotas criticas
- [ ] teste manual de fallback classificado no modo `hybrid`

Pendencias:
- Guard de contexto e reset de sessao para completar Fase 3.

Proximo passo recomendado:
- Implementar context guard no fluxo de chat e rotina de reset controlado de sessao em falhas irrecoveraveis.
- `src/global-config.ts`
- `src/config.ts`
- `README.md`

Checklist de validacao:
- [x] `npm run check`
- [x] teste manual de `init` e leitura de config global

Pendencias:
- Validar manualmente fluxo de `init --force` e valores globais.

Proximo passo recomendado:
- Iniciar Fase 3 com retry utilitario e camada de dedupe/idempotency.

### 2026-02-18 - Reorganizacao de docs + arquitetura por fase

Resumo:
- Reorganizados documentos em subpastas (`core`, `planning`, `research`, `architecture`).
- Mantido na raiz apenas `README.md` e `AGENTS.md`.
- Criados documentos incrementais de arquitetura por fase (1, 2, 3).

Arquivos-chave:
- `docs/core/START-HERE.md`
- `docs/planning/PROJECT-STATUS.md`
- `docs/architecture/README.md`
- `docs/architecture/phases/phase-1.md`
- `docs/architecture/phases/phase-2.md`
- `docs/architecture/phases/phase-3.md`

Checklist de validacao:
- [x] paths de onboarding atualizados em `AGENTS.md` e `README.md`
- [x] referencias principais migradas para novos caminhos

Pendencias:
- Revisar periodicamente os docs de fase conforme evolucao do runtime.

Proximo passo recomendado:
- Iniciar Fase 3 no codigo e manter `docs/architecture/phases/phase-3.md` sincronizado durante a implementacao.

### 2026-02-18 - SOUL.md injetado no system prompt do PI

Resumo:
- `system prompt` do `PiEngineAdapter` deixou de ser hardcoded e agora e montado no bootstrap de config.
- Quando existe `docs/core/SOUL.md` (ou `KAEL_SOUL_PATH`), seu conteudo e anexado ao prompt base do Kael.
- Mesmo comportamento vale para os transportes `pi_sdk` e `openai_http`.

Arquivos-chave:
- `src/config.ts`
- `src/engine/pi-engine-adapter.ts`
- `README.md`
- `docs/architecture/phases/phase-2.md`

Checklist de validacao:
- [x] `npm run check`
- [ ] teste manual do `/chat` validando resposta aderente ao `SOUL.md`

Pendencias:
- Adicionar testes automatizados para garantir montagem do prompt com fallback quando `SOUL.md` nao existir.

Proximo passo recomendado:
- Implementar guard de contexto + reset de sessao (Fase 3) sobre fluxo `pi_sdk`.

### 2026-02-18 - Revisao da abstracao PI: runtime local-first

Resumo:
- Refatorado `PiEngineAdapter` para priorizar runtime local por processo (`stdin/stdout`).
- Mantido `openai_http` apenas como modo legado opcional.
- Config estendida com `KAEL_PI_TRANSPORT`, `KAEL_PI_LOCAL_COMMAND` e `KAEL_PI_LOCAL_ARGS_JSON`.

Arquivos-chave:
- `src/engine/pi-engine-adapter.ts`
- `src/config.ts`
- `src/global-config.ts`
- `README.md`

Checklist de validacao:
- [ ] `npm run check`
- [ ] teste manual do modo `local_process` com comando PI real

Pendencias:
- Conectar runtime local a uma integracao PI nativa (SDK) na fase seguinte.

Proximo passo recomendado:
- Implementar `EmbeddedPiEngine` usando SDK do ecossistema PI (sem shell-out) e manter `local_process` como fallback.

### 2026-02-18 - Fase 2.5: PI SDK embutido (sem dependencia de binario)

Resumo:
- Integrado runtime nativo com `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`.
- Novo transporte default `pi_sdk` (sem exigir comando `pi` no PATH).
- Mantidos transportes de compatibilidade: `local_process` e `openai_http`.
- Bootstrap agora carrega `.env` automaticamente.

Arquivos-chave:
- `src/engine/pi-engine-adapter.ts`
- `src/config.ts`
- `src/global-config.ts`
- `src/app.ts`
- `README.md`

Checklist de validacao:
- [ ] `npm run check`
- [ ] teste manual do `/chat` em `hybrid` com `pi_sdk`

Pendencias:
- Evoluir sessao/contexo do SDK para historico completo multi-turn no adapter.

Proximo passo recomendado:
- Implementar context guard + reset de sessao (pendencias da Fase 3) sobre o caminho `pi_sdk`.

### 2026-02-18 - CLI migrada para commander

Resumo:
- Substituido parser manual da CLI por `commander`.
- Mantidos comandos existentes (`init`, `server`, `chat`, `jobs`) com help/validacao padrao.
- Dependencia `commander` adicionada ao projeto.

Arquivos-chave:
- `src/cli/index.ts`
- `package.json`
- `package-lock.json`

Checklist de validacao:
- [x] `npm run check`
- [x] teste manual de `--help`

Pendencias:
- Nenhuma para esta entrega.

Proximo passo recomendado:
- Iniciar Fase 3 no codigo e manter `docs/architecture/phases/phase-3.md` sincronizado durante a implementacao.

### 2026-02-21 - Refactor estrutural: service layer por dominio (`src/chat`)

Resumo:
- Migrado `ChatService` de `src/services/chat-service.ts` para `src/chat/service.ts`.
- Migrado `TurnOrchestrator` e teste para `src/chat/turn-orchestrator.ts` e `src/chat/turn-orchestrator.test.ts`.
- Atualizados imports da aplicacao e referencias em docs para remover caminhos antigos em `src/services`.
- Formalizada convencao `feature-first` em `docs/architecture/README.md`.

Arquivos-chave:
- `src/chat/service.ts`
- `src/chat/turn-orchestrator.ts`
- `src/chat/turn-orchestrator.test.ts`
- `src/app.ts`
- `docs/architecture/README.md`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Continuar migracoes futuras para padrao por dominio quando novos modulos surgirem.

Proximo passo recomendado:
- Seguir Fase 8.2 (execucao assistida de planos com acoplamento planner + jobs).

### 2026-02-21 - Fase 8.2: planner inteligente inicial (goal -> plan + checkpoints)

Resumo:
- Adicionado `PlannerService.generate()` para gerar plano persistido a partir de objetivo em linguagem natural.
- Cada etapa passou a manter checkpoints de transicao (`status`, `at`, `notes`) e acumulacao de notas com timestamp.
- Exposta nova tool de PI `plan_generate` para criacao de plano por objetivo durante a conversa.
- Exposto endpoint `POST /plans/generate` para uso por UI/API clients.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/engine/pi-tools.ts`
- `src/engine/types.ts`
- `src/chat/service.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Executor assistido de plano ainda nao vincula step automaticamente a job/process session.

Proximo passo recomendado:
- Fase 8.3: executar step com acoplamento ao runtime (`jobs`/`exec`) e atualizar checkpoints automaticamente.

### 2026-02-21 - Fase 8.3: executor assistido de plano (jobs/exec)

Resumo:
- Implementado `PlannerService.executeNext()` para executar o proximo step (`pending/in_progress`) com heuristica de acao (`probe`, `capture`, `transcode`, `hls`, `exec`, `manual`).
- Steps passaram a guardar `execution` (vinculo operacional com `jobId` ou `exec sessionId`) e checkpoint/notas da tentativa.
- Adicionada normalizacao de planos legados no `init()` para garantir `checkpoints` em registros antigos.
- Exposta tool PI `plan_execute_next`.
- Exposto endpoint `POST /plans/:planId/execute-next`.

Arquivos-chave:
- `src/planner/service.ts`
- `src/planner/service.test.ts`
- `src/engine/pi-tools.ts`
- `src/engine/types.ts`
- `src/chat/service.ts`
- `src/api/server.ts`
- `src/api/server.test.ts`

Checklist de validacao:
- [x] `npm run check`
- [x] `npm test`

Pendencias:
- Ainda nao ha reconciliacao automatica para atualizar o step quando `job/exec` termina.

Proximo passo recomendado:
- Fase 8.4: reconciliacao automatica de estado entre runtime (`jobs`/`exec`) e status do step.
