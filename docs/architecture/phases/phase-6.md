# Arquitetura - Fase 6 (Shell Tools no PI)

Status: concluida

## Objetivo

Dar capacidade real de shell ao Kael no engine PI, com controle de processo e politica minima de seguranca/aprovacao.

## Entregas implementadas

- Tool `exec` integrada no `PiEngineAdapter`:
  - execucao local via `sh -lc`
  - suporte a `cwd` (restrito ao workspace), `timeoutMs` e `background`
  - saida limitada (`maxOutputChars`) para evitar explodir contexto/memoria
- Tool `process` integrada no `PiEngineAdapter`:
  - `list`: lista sessoes recentes
  - `poll`: consulta estado de uma sessao
  - `kill`: envia `SIGTERM` para sessao em execucao
- Runtime de shell centralizado:
  - `ShellToolService` com registro de sessoes e ciclo de vida (`running/completed/failed/canceled/timed_out`)
  - logs estruturados (`shell.exec.started`, `shell.exec.finished`, `shell.exec.denied`, etc.)
- Politica e aprovacao persistidas:
  - `ExecApprovalStore` em `~/.kael/exec-approvals.json`
  - modos `security`: `deny | allowlist | full`
  - modos `ask`: `off | on-miss | always`
  - comandos fora da allowlist podem gerar `approval-pending`
- Fluxo completo de aprovacao manual:
  - API: `GET /exec/approvals`, `POST /exec/approvals/:id/approve`, `POST /exec/approvals/:id/deny`
  - CLI: `approvals`, `approval-approve`, `approval-deny`
  - UI: painel de approvals no `Ops Overview` com botoes de approve/deny
  - `exec` passa a aguardar decisao manual por janela configuravel (`KAEL_EXEC_APPROVAL_WAIT_MS`)
- Hardening de policy/infra:
  - parser de allowlist mais conservador (bloqueia redirecionamento, subshell, operadores logicos e multiline em `allowlist`)
  - escrita atomica de `exec-approvals.json` (`tmp + rename`)
  - lock interno para serializar alteracoes e reduzir risco de corrida em read-modify-write
  - testes de fluxo completo: `exec -> approval-pending -> approve/deny -> resultado final`

## Arquivos-chave

- `src/tools/system/shell-tool-service.ts`
- `src/tools/system/shell-approvals.ts`
- `src/agents/pi-tools.ts`
- `src/agents/pi-engine-adapter.ts`
- `src/config.ts`

## Comportamento atual

1. Kael em modo `pi`/`hybrid` pode executar comandos shell via tool calling.
2. Jobs longos podem rodar em background e serem monitorados com `process poll`.
3. Politica de seguranca e aprovacao e carregada da config/env e persistida no arquivo de approvals.
4. Comandos pendentes podem ser aprovados/negados via API, CLI ou UI.
5. O agente recebe resultado final (approved/denied/timeout) apos janela de espera de aprovacao.

## Limites atuais (intencionais)

- Ainda sem stream realtime de logs por SSE/WebSocket (polling via `process`).
