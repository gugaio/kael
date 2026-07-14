# Arquitetura - Fase 19 (MCP Bridge via mcporter)

Status: em andamento

## Objetivo

Adicionar suporte operacional a MCP no Kael sem embutir um runtime MCP no core.
O desenho segue o padrao do OpenClaw: bridge externa via `mcporter`, tools
dedicadas no runtime PI e skill operacional no workspace.

## Escopo da fase

- `McpBridgeService` para executar `mcporter` como subprocesso controlado.
- Surface minima no namespace `mcp` do `EngineToolingNamespaces`:
  - `mcpList`
  - `mcpCall`
- Tools dedicadas no PI:
  - `mcp_list`
  - `mcp_call`
- Configuracao por ENV para habilitar MCP, apontar binario/config e controlar
  transports de maior risco (`http`, `stdio`).
- Skill operacional em `.kael/skills/mcporter/SKILL.md`.

## Fora de escopo desta fase

- Runtime MCP first-class dentro do core do Kael.
- Discovery automatico de servidores MCP por URL arbitraria.
- Endpoints HTTP dedicados para MCP.
- Fluxo completo de auth/OAuth dentro da API do Kael.
- Registry persistente de servidores aprovados com CRUD proprio.

## Decisoes arquiteturais

1. **Bridge externa, nao runtime nativo**
   - O core do Kael nao fala MCP diretamente.
   - O runtime delega para `mcporter`, reduzindo acoplamento e churn de protocolo.

2. **Tools explicitamente tipadas**
   - O agente usa `mcp_list` e `mcp_call`, nao `exec` generico.
   - Isso preserva observabilidade, facilita guardrails e reduz prompt-hacking.

3. **Politica conservadora por transport**
   - `http` e `stdio` ficam desabilitados por default.
   - Calls nomeadas por servidor configurado sao o caminho padrao do MVP.

4. **Compatibilidade com `AgentEngine` atual**
   - A integracao entra pelo namespace `mcp` em `EngineToolingNamespaces` + `createChatTooling`.
   - O contrato do engine continua estavel, mas o tooling interno deixou de ser flat.

## Desenho de componentes

- `McpBridgeService`
  - executa `mcporter list/call`
  - aplica timeout e truncamento de output
  - valida policy para `http`/`stdio`
  - parseia saida JSON
- `createMcpPiTools`
  - serializa requests/response em formato legivel para o PI
  - aplica loop guard e budget por turno
- `.kael/skills/mcporter/SKILL.md`
  - documenta como o agente deve escolher `mcp_list` e `mcp_call`

## Configuracao inicial por ENV

- `KAEL_MCP_ENABLED`
- `KAEL_MCP_BINARY`
- `KAEL_MCP_CONFIG_PATH`
- `KAEL_MCP_TIMEOUT_MS`
- `KAEL_MCP_MAX_OUTPUT_CHARS`
- `KAEL_MCP_ALLOW_HTTP`
- `KAEL_MCP_ALLOW_STDIO`

## Entregas implementadas (incremento 19.0)

- `McpBridgeService` implementado em `src/tools/mcp/mcp-bridge-service.ts`.
- Wiring no app/runtime:
  - `KaelConfig.mcp`
  - `KaelApp.mcp`
  - `EngineToolingNamespaces.mcp.mcpList/mcpCall`
  - `createChatTooling(...)`
- Tools PI:
  - `mcp_list`
  - `mcp_call`
- Budget dedicado de MCP por turno no `pi-tools`.
- Testes unitarios para bridge MCP e para wiring das tools.
- Skill operacional `mcporter` adicionada ao workspace do Kael.

## Entregas implementadas (incremento 19.1)

- Registry persistente de servidores MCP em arquivo local:
  - `name`
  - `transport` (`config|http|stdio`)
  - `target`
  - `enabled`
  - `requireApproval`
- Approvals persistentes por servidor/transport:
  - primeira chamada pode gerar approval pendente;
  - decisao aprovada/negada passa a ser reutilizada nas chamadas futuras.
- Endpoints operacionais para registry/approvals:
  - `GET /mcp/servers`
  - `POST /mcp/servers`
  - `GET /mcp/approvals`
  - `POST /mcp/approvals/:approvalId/approve`
  - `POST /mcp/approvals/:approvalId/deny`
- Telemetria MCP adicionada ao `/health`:
  - servidores configurados/habilitados
  - chamadas totais/list/call
  - bloqueios/falhas
  - approvals pendentes
  - distribuicao por transport
  - ultimo erro / ultima chamada

## Entregas implementadas (incremento 19.2)

- Timeout do PI nao aciona mais fallback silencioso para `SimpleCommandEngine` em modo `hybrid`.
- Motivo: timeout apos chamadas de tool e um erro operacional do turno; ele deve ser reportado ao usuario pelo `ChatService`, com contexto de execucoes recentes, em vez de virar resposta generica do simple engine.
- Budget padrao de tools PI aumentado:
  - total: 24;
  - exec: 12;
  - streamer: 12;
  - web_fetch: 8;
  - web_search: 5;
  - web_research: 3;
  - MCP/Edge: 6;
  - browser: 12;
  - browser_interaction: 8.

## Pendencias da fase

1. CLI dedicada para operar registry/approvals MCP sem depender da API.
2. Melhorar ergonomia de `mcp_call` para aliases/tool names com validacao mais rica.
3. Fluxos de auth/config (`mcporter auth/config`) se surgirem MCPs que exijam autenticacao.
