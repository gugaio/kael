# Arquitetura - Fase 14 (Email Ingress MVP)

Status: em andamento

## Objetivo

Permitir que o Kael receba emails em uma conta dedicada e trate cada novo email
como entrada no loop do agente, com arquitetura pronta para evoluir para
integração push (Gmail Pub/Sub) depois.

## Entregas do MVP

- Contrato de provider de email (`EmailProvider`) desacoplado do runtime.
- `EmailIngestService` para transformar emails recebidos em turnos do `ChatService`.
- Provider inicial `GmailPop3Provider` (polling POP3 com estado de UIDs vistos).
- Agendamento persistente `email_poll` no scheduler já existente.
- Guard de concorrencia no ingest (`pollInFlight`) para evitar processamento duplicado em ticks sobrepostos.
- Dedupe/lock persistente por mensagem (`provider:id`) no ingest para evitar processamento duplicado entre multiplos processos/workers.
- Sender SMTP opcional (`GmailSmtpSender`) para auto-reply por email usando a mesma conta dedicada.

## Decisao arquitetural

- Mantivemos ingest desacoplado por interface:
  - hoje: `gmail_pop3` (polling simples);
  - futuro: `gmail_pubsub` (watch/push) sem quebrar o fluxo interno.
- O core do Kael nao depende de detalhe Gmail; depende do provider.

## Pendencias da fase

1. Adicionar provider de Gmail API/PubSub (modo push) mantendo o mesmo contrato.
2. Expor metricas de dedupe (`duplicate_skipped`, `in_flight`) no `/health` para tuning operacional.
