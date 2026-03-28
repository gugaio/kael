# Arquitetura - Fase 21 (Clark Runtime Satelite)

Status: concluida

## Objetivo

Adicionar um runtime satelite, incubado inicialmente em `apps/clark`, para
permitir que o Kael acione capacidades disponiveis em ambientes especificos aos
quais o orquestrador central nao tem acesso direto.

O Clark nao substitui o Kael nem replica o runtime principal. Ele funciona como
executor outbound-only de capacidades de ambiente, controlado pelo
orquestrador remoto via WebSocket.

## Decisao arquitetural

- Incubar o projeto em `apps/clark` dentro do monorepo para acelerar iteracao e
  manter contexto compartilhado durante o bootstrap.
- Tratar `apps/clark` como produto desacoplado desde o dia 1:
  - `package.json` proprio;
  - `tsconfig.json` proprio;
  - contratos locais;
  - nenhuma dependencia de runtime interno do Kael.
- Separar configuracao operacional e configuracao declarativa:
  - `.env` para parametros simples do processo;
  - `clark.config.json` para providers e bindings de capabilities.
- Usar modelo explicito de capabilities, nao proxy generico.
- Fazer conexao somente outbound para a VPS; nenhuma porta inbound exposta no
  host do Clark.
- Comecar pelo fluxo minimo:
  - `register`;
  - `heartbeat`;
  - `task_request`;
  - `task_result`.

## Contratos canonicos iniciais

- `ClientInfo`
- `CapabilityDescriptor`
- `TaskRequest`
- `TaskResult`
- `ServerMessage`
- `ClientMessage`

Nota:
- Os contratos devem existir em TypeScript e tambem em schemas runtime com
  `zod`, mantendo validacao explicita nas bordas do protocolo.

## Estrutura inicial prevista

- `apps/clark/src/cli`
- `apps/clark/src/config`
- `apps/clark/src/core`
- `apps/clark/src/protocol`
- `apps/clark/src/capabilities`
- `apps/clark/src/services`
- `apps/clark/src/tests`

## MVP previsto

- CLI local com comando principal `clark daemon`.
- Conexao WebSocket com reconexao/backoff.
- Kael expondo endpoint WebSocket minimo em `/ws` para handshake inicial.
- Registro do client e envio periodico de heartbeat.
- Registry de capabilities de ambiente.
- Dispatch de tasks enviadas pelo servidor remoto.
- Capabilities iniciais:
  - `system.info`
  - `network.check`
  - `internal.http.fetch` restrita.
  - capabilities derivadas de MCP HTTP local por bindings explicitos.

## MCP HTTP

- O Clark nao expõe um MCP generico para o Kael.
- O Clark descobre servidores MCP HTTP configurados em seu ambiente.
- Cada binding explicito mapeia:
  - `capabilityName`
  - `serverName`
  - `toolName`
- Providers e bindings ficam fora do codigo em `clark.config.json`, validados
  no startup por schema.
- O `register` do client continua orientado a capabilities, mas inclui
  metadados resumidos de providers MCP HTTP disponiveis.
- Apenas bindings configurados e realmente presentes no provider sao expostos ao
  Kael.
- Quando o endpoint MCP remoto nao fala JSON-RPC HTTP simples e exige fluxo
  baseado em SSE/stream, o Clark pode usar `mcporter` como bridge local via um
  provider `mcp-http-bridge`.

Exemplo:

- provider MCP HTTP: `corp-observability`
- tool MCP: `get_session_details`
- capability exposta ao Kael: `corp.session.fetch`

## Guardrails iniciais

- Sem autenticacao/aprovacao no primeiro recorte para reduzir escopo de
  bootstrap.
- `internal.http.fetch` deve nascer restrita:
  - allowlist configuravel;
  - `GET` apenas no MVP;
  - timeout;
  - limite de tamanho de resposta;
  - sanitizacao basica.
- Integracoes HTTP com segredo local podem usar profiles declarados
  (`httpProfiles`) para que o Kael passe apenas `profile + path + query`,
  enquanto base URL e headers sensiveis ficam apenas no Clark.
- Toda task deve gerar logs estruturados com `taskId`, `capability`, duracao e
  status.
- MCP HTTP entra apenas por bindings allowlistados; o Kael nao recebe acesso
  irrestrito ao catalogo bruto de tools do provider.

## Handshake minimo no Kael

- Endpoint inicial: `WS /ws`
- Mensagens suportadas no primeiro recorte:
  - `client.register`
  - `client.heartbeat`
  - `server.registered`
- O Kael mantem um registry em memoria dos clients conectados, suficiente para:
  - observar conexoes ativas;
  - validar o protocolo;
  - preparar o proximo incremento de `task_request`/`task_result`.

## Proximos incrementos

1. Integrar primeira capability real de negocio acessivel em ambiente remoto
   especifico (ex.: Youbora/internal API ou binding MCP corporativo de session lookup).
2. Introduzir autenticacao simples e camada de approval local sem quebrar os
   contratos iniciais.
3. Evoluir bindings MCP com schemas de input/output mais restritos por
   capability.
