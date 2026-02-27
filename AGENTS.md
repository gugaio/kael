# AGENTS.md - Kael

Instrucoes para qualquer agente que atuar neste repositorio.

## Missao

Construir o Kael como super agente local de video e automacao, com foco em execucao confiavel de pipelines de midia.

## Bootstrap obrigatorio (inicio de cada sessao)

1. Ler `docs/core/START-HERE.md`.
2. Ler `docs/core/SOUL.md`.
3. Ler `docs/planning/PROJECT-STATUS.md`.
4. Ler `docs/planning/PROJECT-VISION.md` e `docs/planning/AGENT-DEV-GUIDE.md` se precisar contexto adicional.
5. Ler a arquitetura da fase ativa em `docs/architecture/phases/`.

## Prioridades tecnicas

1. Preservar arquitetura simples e evolutiva.
2. Favorecer contratos/abstracoes antes de acoplamentos fortes.
3. Entregar funcionalidade real de video (jobs, transcode, HLS, stream capture) antes de features perifericas.
4. Copiar do OpenClaw os padroes essenciais (resiliencia/sessao), nao o volume total de features.

## Regras de implementacao

1. TypeScript strict.
2. Mudancas pequenas e verificaveis.
3. Evitar complexidade prematura.
4. Manter compatibilidade com o contrato atual de engine (`AgentEngine`).
5. AO CRIAR UM NOVO ENDPOINT: atualizar `docs/api.md` com o novo endpoint no diagrama Mermaid e na tabela de referencia rapida.

## Persistencia e estado

1. Default em `./.kael-data` (pode sobrescrever por `KAEL_DATA_DIR`).
2. Sessao em JSONL append-only.
3. Jobs com store e logs persistentes.

## Atualizacao de status (obrigatorio)

A cada commit funcional:

1. Atualizar `docs/planning/PROJECT-STATUS.md`:
   - fase impactada;
   - entrega realizada;
   - pendencias;
   - proximo passo recomendado.
2. Se houver mudanca de direcao arquitetural, atualizar tambem `docs/core/START-HERE.md`.
3. Se houver mudanca estrutural de runtime, atualizar o arquivo da fase correspondente em `docs/architecture/phases/`.

## Escopo atual

Foco: CLI + API + engine desacoplada + jobs de video.

Nao focar agora em:

1. UI web rica.
2. Plugins/channels multi-plataforma.
3. Sistemas extensivos de skill marketplace.
