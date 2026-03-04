# Arquitetura - Fase 16 (Browser Control para teste de sites)

Status: em andamento

## Objetivo

Adicionar controle de browser no Kael para permitir testes de sites por conversa,
em etapas curtas, com observabilidade e risco operacional controlado.

## Decisao arquitetural

- Reutilizar o padrao atual do core:
  - contrato no `EngineTooling`;
  - implementacao no dominio (`src/tools/browser`);
  - wiring no `createKaelApp` e `createChatTooling`;
  - telemetria no `/health`.
- Evitar copiar a superficie completa do OpenClaw no inicio.
- Evoluir por fases: primeiro contrato + runtime, depois leitura, depois interacao.

## Fases de entrega

### Fase 16.0 - Foundations

Entregas:
- Contrato `browserCommand` no `EngineTooling`.
- Runtime `BrowserToolService` com telemetria base e gate por config.
- Configuracoes `KAEL_BROWSER_*`.
- Telemetria `browserRuntime` no `/health`.

O que sera possivel fazer:
- Ver se o runtime de browser esta habilitado/desabilitado via `/health`.
- Executar chamada de browser e receber resposta controlada de `disabled` ou `not_implemented`.

Como testar:
1. Subir servidor e chamar `GET /health`.
2. Verificar `metrics.browserRuntime`.
3. Com `KAEL_BROWSER_ENABLED=false`, validar retorno `disabled`.
4. Com `KAEL_BROWSER_ENABLED=true`, validar retorno `not_implemented`.

### Fase 16.1 - Browser read-only (navegacao + evidencia)

Entregas implementadas:
- Acoes `start|open|navigate|snapshot_text|screenshot|close`.
- Sessao de browser por `sessionKey`.
- Persistencia de screenshots em `./.kael-data/browser/artifacts`.
- Limite de screenshots por sessao (`KAEL_BROWSER_MAX_SCREENSHOTS_PER_TURN`).

O que sera possivel fazer:
- Abrir site, navegar, extrair snapshot textual e gerar screenshot.

Como testar:
1. Abrir `https://example.com`.
2. Navegar para outra URL.
3. Capturar texto da pagina.
4. Capturar screenshot e validar arquivo salvo.

### Fase 16.2 - Interacao UI (teste funcional)

Entregas implementadas:
- Acoes `click|type|press|wait_for`.
- Estrategia de seletor com fallback.
- Erros operacionais amigaveis (timeout, elemento nao encontrado, etc.).

O que sera possivel fazer:
- Executar fluxo funcional simples de formulario/busca/login.

Como testar:
1. Preencher campo (`type`).
2. Acionar botao (`click`).
3. Esperar resultado (`wait_for`).
4. Capturar screenshot final.

### Fase 16.3 - Hardening operacional

Entregas implementadas:
- Limpeza de sessoes orfas por TTL.
- Eviccao por limite maximo de sessoes.
- Budget anti-loop dedicado para acoes browser.
- Telemetria detalhada por acao/erro.

O que sera possivel fazer:
- Rodar sequencias repetidas de teste sem degradar runtime.

Como testar:
1. Repetir o mesmo fluxo 10+ vezes.
2. Validar cleanup de sessoes antigas.
3. Verificar contadores de erro/timeout no `/health`.

Notas de implementacao atual:
- Cleanup por TTL de sessao implementado por `KAEL_BROWSER_SESSION_TTL_MS`.
- Limite de sessoes simultaneas implementado por `KAEL_BROWSER_MAX_SESSIONS` com eviccao da sessao mais antiga.
- Budget dedicado no PI:
  - `maxBrowserCalls`;
  - `maxBrowserInteractionCalls` (`click/type/press/wait_for`).
- Telemetria de browser runtime agora inclui:
  - `actionCalls`;
  - `actionFailures`;
  - `avgLatencyMsByAction`;
  - `expiredSessionsClosed`;
  - `evictedSessions`;
  - `lastError`.

### Fase 16.4 - UX e docs operacionais

Entregas implementadas:
- Comandos rapidos opcionais para browser no fast-path.
- Guia operacional de uso via CLI/chat.
- Atualizacao de status/arquitetura conforme mudancas.

O que sera possivel fazer:
- Onboarding rapido para operacao do browser control no time.

Como testar:
1. Seguir guia do zero.
2. Executar fluxo completo sem ajustes manuais.
3. Validar aderencia docs x comportamento real.

## Configuracao prevista

- `KAEL_BROWSER_ENABLED` (`true|false`)
- `KAEL_BROWSER_HEADLESS` (`true|false`)
- `KAEL_BROWSER_DEFAULT_TIMEOUT_MS`
- `KAEL_BROWSER_ACTION_TIMEOUT_MS`
- `KAEL_BROWSER_MAX_SCREENSHOTS_PER_TURN`
- `KAEL_BROWSER_SESSION_TTL_MS`
- `KAEL_BROWSER_MAX_SESSIONS`
- `KAEL_BROWSER_ARTIFACT_DIR`

## Pendencias da fase (atual)

1. Tornar smoke e2e de browser obrigatorio em ambiente com permissao de launch (job dedicado de CI runner).
2. Evoluir parser de argumentos dos atalhos slash para aceitar strings com aspas de forma robusta.
3. Avaliar estrategia de reutilizacao de browser/context por sessao para reduzir custo de start.
