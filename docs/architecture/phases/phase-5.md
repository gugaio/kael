# Arquitetura - Fase 5 (Hardening e Observabilidade)

Status: em andamento

## Objetivo

Evoluir robustez operacional com sinais de health reais e guardrails de seguranca para execucao de jobs.

## Entregas implementadas (incremento atual)

- `GET /health` enriquecido com sinais operacionais:
  - `version`
  - `uptimeSec`
  - `metrics.sessions`
  - `metrics.totalJobs`
  - `metrics.jobsByStatus`
  - `metrics.schedules.total/enabled/disabled`
- Politica de seguranca de execucao para jobs de video:
  - validacao de input/output path
  - validacao de URL de stream por protocolo permitido
  - validacao de args de usuario com limite maximo e bloqueio de flags criticas (`-i`, `-y`)
  - erro de dominio dedicado (`VideoJobValidationError`) mapeado para `400 BAD_REQUEST` na API
- Configuracao de seguranca por ambiente:
  - `KAEL_SAFE_PATHS_ENABLED`
  - `KAEL_ALLOWED_PATHS`
  - `KAEL_MAX_JOB_ARGS`

## Comportamento atual

1. API responde health com snapshot objetivo do estado operacional.
2. Jobs invalidos sao rejeitados antes de spawn do processo.
3. Rotas de job retornam erro padrao de API quando validacao falha.

## Proximos incrementos recomendados

- Limites de concorrencia por tipo de job.
- Timeout por tipo de job e cancelamento controlado.
- Testes de integracao para `/jobs/*` cobrindo cenarios de falha de seguranca.

