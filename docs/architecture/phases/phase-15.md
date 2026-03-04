# Arquitetura - Fase 15 (Multimodal Ingress MVP)

Status: em andamento

## Objetivo

Permitir que o Kael receba imagem e audio como entrada de conversa, com pipeline
incremental para evoluir de "ingress + contexto" para entendimento multimodal
completo (descricao de imagem e transcricao de audio).

## Entregas planejadas

- Contrato comum de anexos de entrada no core (`image|audio`) desacoplado do canal.
- Pass-through de anexos no fluxo `API -> ChatService -> TurnOrchestrator -> Engine`.
- Ingest de anexos no Discord com download controlado (limites de tamanho/timeout).
- Persistencia de hint textual de anexos no transcript da sessao para continuidade.
- Base para etapa seguinte de `media-understanding` (providers de visao/transcricao).

## Decisao arquitetural

- O canal (Discord/API/email no futuro) entrega anexos em formato canônico do core.
- O core nao depende de um canal especifico para multimodal.
- O entendimento multimodal sera um modulo separado, plugavel por provider/modelo.

## Pendencias da fase

1. Implementar `MediaUnderstandingService` com providers de imagem/audio.
2. Injetar resultado multimodal no contexto do turno sem poluir `CommandBody`.
3. Expor observabilidade de anexos processados/erros no `/health`.
