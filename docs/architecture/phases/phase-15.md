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
- `MediaUnderstandingService` com implementacao `noop` e implementacao inicial `openai`:
  - descricao de imagem;
  - transcricao de audio.
- Injecao do contexto multimodal no turno LLM via bloco `[media_context]`.
- Telemetria de runtime multimodal em `/health` (`mediaRuntime`).
- Saida multimodal inicial: artifacts de imagem gerada (`image_generate`) enviados como anexo em reply de email SMTP.

## Decisao arquitetural

- O canal (Discord/API/email no futuro) entrega anexos em formato canônico do core.
- O core nao depende de um canal especifico para multimodal.
- O entendimento multimodal sera um modulo separado, plugavel por provider/modelo.

## Pendencias da fase

1. Melhorar robustez de parsing de resposta de modelos vision em formatos alternativos.
2. Adicionar fallback opcional para provider de audio dedicado (ex.: Deepgram) no mesmo contrato.
3. Adicionar sanitizacao/normalizacao de MIME mais rigorosa para anexos (data URL/base64 malformado).
