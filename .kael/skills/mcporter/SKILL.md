---
name: mcporter
description: Opera servidores MCP configurados no Kael via tools dedicadas mcp_list e mcp_call.
argument-hint: "[server|server.tool] [json-opcional]"
disable-model-invocation: false
user-invocable: true
---

# mcporter

Use MCP no Kael por meio das tools dedicadas, nao por `exec`, exceto se estiver
depurando falha de infraestrutura.

Fluxo preferido:

1. Descubra os servidores/configuracoes disponiveis com `mcp_list`.
2. Se um servidor for conhecido, liste schema/tools dele com `mcp_list`.
3. Execute a tool com `mcp_call`.
4. Se a chamada falhar por policy (`http`/`stdio` desabilitado), explique o
   bloqueio claramente em vez de insistir.

Exemplos:

- Listar servidores:
  - `mcp_list {}`
- Inspecionar schema de um servidor:
  - `mcp_list {"server":"linear","schema":true}`
- Executar uma tool nomeada:
  - `mcp_call {"target":"linear.list_issues","argumentsJson":"{\"limit\":5}"}`

Regras:

- Prefira `server.tool` configurado no `mcporter`.
- Nao use target HTTP arbitrario sem necessidade real.
- Nao use `stdioCommand` a menos que o ambiente tenha permitido explicitamente.
- Se precisar passar argumentos, envie JSON valido em `argumentsJson`.
