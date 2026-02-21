# Kael UI Guide

Guia oficial da interface do Kael.

Objetivo: manter uma fonte unica para qualquer instancia nova entender rapidamente:
- qual e a visao da UI;
- o que ja foi implementado;
- o que ainda falta;
- qual fase vem em seguida.

## Visao de Produto (UI)

Kael UI deve ser **ops-first**, nao chat-first.

Isso significa:
- A tela principal e operacao viva (jobs, schedules, eventos, health).
- Chat e uma superficie de comando/colaboracao, nao o centro da navegacao.
- Todo comando relevante gera objetos operacionais rastreaveis (job, schedule, evento).
- O usuario nunca deve ficar sem visibilidade do que esta acontecendo.

## Principios de UX

- Estado explicito sempre: `queued`, `running`, `succeeded`, `failed`, `canceled`, `timed_out`.
- Iniciativa com disciplina: Kael notifica quando ha acao necessaria; evita spam.
- Controle humano claro: cancelar, pausar, retomar e confirmar acoes sensiveis.
- Baixa latencia percebida: feedback imediato, mesmo quando o trabalho e longo.
- Logs e diagnostico sao first-class: facil abrir, seguir e agir.

## Arquitetura de Informacao (alvo)

- `Ops Overview` (default)
- `Jobs`
- `Schedules`
- `Chat Sessions`
- `Health`
- `Settings`

## Plataforma (estrategia)

- Fase inicial: **Web responsivo / PWA-first**.
- Fase posterior: **Electron** para experiencia desktop power-user.
- Mobile nativo (Flutter) somente apos validar uso real e necessidade clara.

## Roadmap de Fases da UI

### UI-0 - Research e Definicao

Status: **Concluida**

Entregas:
- Direcao de produto e UX definida (ops-first).
- Decisao de plataforma inicial (Web/PWA-first).
- Fluxos criticos mapeados (chat->job, heartbeat/eventos, logs, cancelamento).

### UI-1 - MVP Operacional Web

Status: **Em andamento**

Escopo minimo:
- [x] Ops Overview com polling.
- [x] Plans list + detail + execute-next + reconcile.
- [x] Cancelamento de plano pela UI.
- [x] Jobs list + detail + log tail + cancel.
- [x] Schedules list + pause/resume.
- [x] Chat sessions com envio de mensagem.
- [x] Chat com sugestao contextual de plano + composer de geracao de plano.
- [x] Health badge e pagina de saude.
- [x] Painel de approvals de exec no Ops (approve/deny).
- [ ] Cards operacionais de job inline no chat.

DoD:
- [x] Usuario consegue criar/acompanhar/cancelar jobs sem CLI.
- [ ] Usuario consegue pausar/retomar schedules sem CLI.
- [x] Usuario consegue entender estado geral da operacao em uma tela.
- [ ] Experiencia funcional em desktop e mobile.

### UI-2 - Tempo Real e Diferenciacao

Status: **Prevista**

Escopo:
- SSE para eventos e atualizacoes de job/schedule.
- Log follow em tempo real.
- Event stream com severidade e acoes sugeridas.
- Melhorias de diagnostico (jump para erro, filtros).

DoD:
- [ ] Reducao de latencia percebida em monitoramento e resposta.
- [ ] Menos cliques para agir sobre falhas.
- [ ] Notificacoes mais uteis e menos ruidosas.

### UI-3 - Power UX e Canal Desktop

Status: **Prevista**

Escopo:
- Shell Electron (integracoes desktop).
- Melhorias avancadas de operacao e produtividade.
- Voz (opcional e progressiva, com confirmacao para acoes sensiveis).

DoD:
- [ ] Fluxo desktop mais rapido que navegador puro para operadores frequentes.
- [ ] Recursos avancados sem comprometer confianca/controle.

## Estado Atual (implementado no backend que a UI pode usar hoje)

- API de chat, jobs, schedules, health.
- API de approvals de exec (`/exec/approvals` + approve/deny).
- Cancelamento manual de jobs (`POST /jobs/:jobId/cancel`).
- Status operacional com observabilidade (`/health`, logs estruturados).
- Concurrency, timeout e seguranca de execucao ja no core.
- Testes E2E de `/jobs/*` cobrindo seguranca, timeout e cancelamento.

## Gaps de API recomendados para UI-2

- `GET /jobs?state=&type=&cursor=&limit=`
- `GET /jobs/:jobId/log?tail=&cursor=`
- `GET /events/stream` (SSE)
- `GET /jobs/:jobId/log/stream` (SSE)

## Ritual de Atualizacao (obrigatorio a cada commit de UI)

1. Atualizar fase atual (`Status` + checklist DoD).
2. Registrar o que entrou em "Estado Atual".
3. Se mudou direcao, registrar em "Decisoes".
4. Referenciar o commit em `docs/planning/PROJECT-STATUS.md`.

## Decisoes

- 2026-02-19: UI sera ops-first.
- 2026-02-19: Plataforma inicial sera Web responsivo / PWA-first.
- 2026-02-19: Chat nao sera homepage; Ops Overview sera a entrada principal.
- 2026-02-19: UI-1 iniciada em `ui/` com React + Vite + Tailwind + TanStack Query + React Router + Zod.
- 2026-02-20: Ops ganhou painel de approvals de exec para fechar o ciclo de autorizacao manual.
