# Clark

Clark e um runtime satelite incubado em `apps/clark` para permitir que o Kael
na VPS execute capacidades disponiveis em um ambiente especifico ao qual o
orquestrador central nao tem acesso direto.

## O que ele faz

- roda como CLI/daemon local;
- abre conexao WebSocket outbound para a VPS;
- registra capacidades disponiveis;
- anuncia providers MCP HTTP locais e capabilities derivadas deles;
- recebe tasks remotas;
- executa no ambiente onde esta rodando;
- devolve resultados estruturados.

## Modelo mental

- Kael = orquestrador remoto
- Clark = executor de capacidades de ambiente

Fluxo:

1. `clark daemon` conecta na VPS
2. registra `clientId`, host e capabilities
3. Kael envia uma `task_request`
4. Clark executa a capability local
5. Clark devolve `task_result`
6. Kael continua a resposta ao usuario

## MVP atual

Comandos:

- `clark daemon`
- `clark status`
- `clark capabilities`
- `clark doctor`

Capabilities:

- `system.info`
- `network.check`
- `internal.http.fetch`
- `internal.http.profile_request`
- capabilities derivadas de MCP HTTP configurado, como `corp.session.fetch`

Exemplos de ambiente que um Clark pode representar:

- notebook em rede interna
- notebook conectado por VPN
- host com MCPs corporativos configurados
- maquina com browser, ferramentas ou credenciais locais

## Seguranca do MVP

Este recorte inicial deliberadamente nao implementa autenticacao nem approval.
Mesmo assim, `internal.http.fetch` ja nasce restrita:

- apenas `GET`
- allowlist de hosts por config
- timeout
- limite de bytes lidos
- sem virar proxy generico

## Configuracao

Use duas camadas:

- `.env` para operacao do processo
- `clark.config.json` para providers e bindings declarativos

Copie `.env.example` para `.env` e ajuste:

```bash
CLARK_SERVER_URL=ws://127.0.0.1:8787/ws
CLARK_CLIENT_ID=clark-local
CLARK_CLIENT_NAME=Clark Local Notebook
CLARK_HTTP_ALLOWLIST=localhost,127.0.0.1
CLARK_CONFIG_PATH=./clark.config.json
CLARK_MCP_BRIDGE_BINARY=mcporter
CLARK_MCP_BRIDGE_CONFIG_PATH=
CLARK_MCP_BRIDGE_MAX_OUTPUT_CHARS=500000
TRACEVIEW_API_TOKEN=seu-token-local
```

Exemplo de `clark.config.json`:

```json
{
  "providers": {
    "youbora": {
      "kind": "mcp-http-bridge",
      "url": "https://youbora-mcp.apps.tsuru.gcp.i.globo/mcp",
      "enabled": true,
      "timeoutMs": 5000
    }
  },
  "httpProfiles": {
    "traceview": {
      "baseUrl": "https://traceview.example.com",
      "allowedMethods": ["GET"],
      "defaultHeaders": {
        "x-api-token": "${env:TRACEVIEW_API_TOKEN}"
      }
    }
  },
  "capabilities": [
    {
      "name": "youbora.metrics.get",
      "description": "Consulta metricas agregadas de QoE no Youbora",
      "provider": "youbora",
      "tool": "get_metrics",
      "requiresApproval": false
    },
    {
      "name": "youbora.rawdata.get",
      "description": "Consulta sessoes brutas no Youbora",
      "provider": "youbora",
      "tool": "get_rawdata",
      "requiresApproval": false
    },
    {
      "name": "youbora.events.get",
      "description": "Consulta eventos de player no Youbora",
      "provider": "youbora",
      "tool": "get_events",
      "requiresApproval": false
    }
  ]
}
```

Exemplo de task usando profile HTTP local sem expor token ao Kael:

```json
{
  "id": "task-001",
  "capability": "internal.http.profile_request",
  "input": {
    "profile": "traceview",
    "path": "/sessions/abc123",
    "query": {
      "includeMetrics": true
    }
  }
}
```

## MCP HTTP no Clark

O Clark nao expoe um "MCP generico" para o Kael. Ele faz o binding de tools MCP
disponiveis em seu ambiente para capabilities explicitas declaradas em
`clark.config.json`.

Quando o provider usa um transporte MCP HTTP/SSE que nao funciona como JSON-RPC
direto, o Clark pode usar `mcporter` como bridge local atraves do kind
`mcp-http-bridge`.

Exemplo:

- MCP HTTP local: `corp-observability`
- tool MCP: `get_session_details`
- capability anunciada ao Kael: `corp.session.fetch`

No `register`, o Clark envia:

- `capabilities`: lista executavel pelo Kael
- `providers`: metadados resumidos dos MCPs HTTP disponiveis

Quando o Kael pedir `corp.session.fetch`, o Clark faz a chamada MCP HTTP no
ambiente onde esta rodando e devolve o resultado como `task_result`.

## Desenvolvimento

```bash
npm --prefix apps/clark run check
npm --prefix apps/clark run test
npm --prefix apps/clark run dev
npx tsx apps/clark/src/cli/index.ts doctor
```

## Doctor

Use `clark doctor` para validar:

- leitura do `.env`
- leitura do `clark.config.json`
- conectividade WebSocket com o servidor remoto
- reachability dos providers MCP HTTP
- existencia das tools configuradas nos bindings
- capabilities finais montadas pelo runtime

## Build

```bash
npm --prefix apps/clark run build
npm --prefix apps/clark run start
```

## Protocolo minimo

Client -> Server:

- `client.register`
- `client.heartbeat`
- `client.task.result`

Server -> Client:

- `server.registered`
- `server.task.request`

Exemplo de task:

```json
{
  "version": 1,
  "type": "server.task.request",
  "timestamp": "2026-03-28T18:00:00.000Z",
  "payload": {
    "task": {
      "id": "task-001",
      "capability": "corp.session.fetch",
      "input": {
        "sessionId": "abc123"
      }
    }
  }
}
```

Exemplo de resultado:

```json
{
  "version": 1,
  "type": "client.task.result",
  "timestamp": "2026-03-28T18:00:01.000Z",
  "payload": {
    "result": {
      "taskId": "task-001",
      "capability": "corp.session.fetch",
      "success": true,
      "output": {
        "sessionId": "abc123"
      },
      "durationMs": 55
    }
  }
}
```
