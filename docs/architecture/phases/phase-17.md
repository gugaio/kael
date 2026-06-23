# Arquitetura - Fase 17 (Orquestracao de Planos v2)

Status: em andamento

## Objetivo

Evoluir o executor de planos para operar fluxos reais com maior confiabilidade,
indo alem de "disparar step" e cobrindo controle de lifecycle, validacao de
resultado e comportamento explicito em falhas.

## Entregas planejadas

- Novas acoes de controle de execucao no planner:
  - `wait_execution` (aguarda conclusao de `job/exec`);
  - `approve_execution` (aprova pendencia de shell approval);
  - `cancel_execution` (cancela `job/exec` em andamento).
- Novas acoes de validacao:
  - `assert_file_exists`;
  - `assert_hls_ok`;
  - `assert_duration`.
- Branching leve por step:
  - `on_fail: retry|skip|stop`;
  - `maxRetries` por etapa.
- Telemetria operacional de planos expandida:
  - retries por step;
  - taxa de falha por tipo de acao;
  - motivo de stop/skip.

## Decisao arquitetural

- Manter contrato atual do planner (`executeNext`/`reconcile`).
- Acoes de dominio (video, audio, etc.) sao registradas via `ActionRegistry`:
  - Cada handler define `requiredInputs` e `execute()`;
  - Planner core conhece apenas `exec`, `wait_execution`, `cancel_execution`.
- `PlannerExecuteRuntime` contem apenas callbacks de infraestrutura:
  - `execCommand`, `getJob`, `pollExec`, `cancelJob`, `cancelExec`;
  - Callbacks de dominio (ex-`startProbeMedia`) foram removidos.
- Separar claramente:
  - acoes que "disparam trabalho";
  - acoes que "controlam/observam trabalho";
  - acoes que "validam saida".
- Reusar scheduler apenas para reconciliacao/observacao, sem transformar o
  scheduler em executor principal de steps.

## Pendencias da fase

1. Definir schema canônico de `on_fail` e de contador de tentativas por step.
2. Definir superficie minima de validacao para video sem acoplamento forte no planner.
3. Ajustar docs de API e PI tools conforme novas acoes forem entrando.

## Entregas implementadas (incremento atual)

- Novas actions no planner:
  - `wait_execution`;
  - `cancel_execution`.
- Runtime de `executeNext` simplificado com callbacks de infraestrutura apenas:
  - `getJob`, `pollExec`, `cancelJob`, `cancelExec`, `execCommand`.
- `ActionRegistry` para handlers de acao de dominio (video registra probe, capture, transcode, hls).
- Priorizacao de step de controle no `nextAction` quando ha step anterior em
  `in_progress` com execucao em curso.
- Suporte de `targetStepIndex` para definir explicitamente qual step sera
  observado/cancelado.
