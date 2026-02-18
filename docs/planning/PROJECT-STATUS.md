# PROJECT STATUS - Kael

Ultima atualizacao: **2026-02-18**
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

Status: **Em andamento**

Objetivos:
- Retry com backoff + jitter.
- Classificacao de erro e fallback de modelo.
- Guard de contexto e reset de sessao em falhas irrecoveraveis.
- Dedupe/idempotency para requests.

Definition of Done (checklist):
- [x] Retry utilitario com politicas configuraveis.
- [x] Fallback classificado por tipo de erro.
- [x] Guard de contexto aplicado antes de chamada de modelo.
- [ ] Reset automatico de sessao para falhas fatais.
- [x] Dedupe/idempotency ativo nos endpoints criticos.

### Fase 4 - Autonomia (Heartbeat + Cron)

Status: **Planejada**

Objetivos:
- Heartbeat produtivo (nao so ACK).
- Scheduler cron persistente com catch-up.
- Notificacao de mudancas relevantes de jobs.

Definition of Done (checklist):
- [ ] Heartbeat executando em intervalo configuravel.
- [ ] Resposta silenciosa quando nao houver acao.
- [ ] Cron persistente com recuperacao apos restart.
- [ ] Monitoramento de jobs com notificacoes relevantes.

### Fase 5 - Hardening e Observabilidade

Status: **Planejada**

Objetivos:
- Testes (unit/integration/e2e).
- Logs estruturados e health mais rico.
- Politicas de seguranca de execucao.

Definition of Done (checklist):
- [ ] Suite minima de testes unitarios para stores/engine/jobs.
- [ ] Testes de integracao de API (chat + jobs).
- [ ] Logs estruturados com contexto de sessao/job.
- [ ] Health endpoint com sinais operacionais.
- [ ] Politica de execucao segura documentada e aplicada.

## Registro de Atualizacoes por Commit

### 2026-02-18 - Fase 3 (incremento): TurnOrchestrator + context guard multi-turn

Resumo:
- Introduzido `TurnOrchestrator` para centralizar preparacao de turnos antes da engine.
- Contexto conversacional agora entra no PI com janela limitada por mensagens e caracteres.
- `PiEngineAdapter` passou a receber historico recente (HTTP como mensagens; SDK/local-process como prompt serializado).

Arquivos-chave:
- `src/services/turn-orchestrator.ts`
- `src/services/chat-service.ts`
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
