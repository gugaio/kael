# Arquitetura - Fase 5 (Hardening e Observabilidade)

Status: concluida

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
- Runtime control para jobs:
  - fila interna por capacidade
  - limite de concorrencia (`KAEL_MAX_CONCURRENT_JOBS`)
  - timeout de execucao (`KAEL_JOB_TIMEOUT_MS`)
  - cancelamento controlado com grace period (`KAEL_JOB_KILL_GRACE_MS`)
- Cancelamento manual de jobs:
  - endpoint `POST /jobs/:jobId/cancel`
  - jobs em fila viram `canceled` imediatamente
  - jobs em execucao recebem sinal de terminacao e finalizam como `canceled`
- Health com metricas de runtime dos workers:
  - `metrics.runtimeJobs.activeJobs`
  - `metrics.runtimeJobs.queuedJobs`
  - `metrics.runtimeJobs.maxConcurrentJobs`

## Comportamento atual

1. API responde health com snapshot objetivo do estado operacional.
2. Jobs invalidos sao rejeitados antes de spawn do processo.
3. Rotas de job retornam erro padrao de API quando validacao falha.
4. Jobs entram em fila quando o limite de concorrencia e atingido.
5. Jobs longos sao encerrados automaticamente ao ultrapassar timeout configurado.

## Proximos incrementos recomendados

- Limites de concorrencia por tipo de job (atualmente o limite e global).
- Timeout por tipo de job (atualmente o timeout e global).
- Testes de integracao para `/jobs/*` cobrindo cenarios de falha de seguranca.
