# Arquitetura - Fase 18 (Skills no Core)

Status: em andamento

## Objetivo

Introduzir suporte nativo a skills baseadas em arquivo Markdown, com discovery em
`.kael/skills`, invocacao manual via slash command e invocacao automatica
controlada por descricao/frontmatter, sem quebrar o contrato atual de engine.

## Escopo da fase

- Discovery de skills no workspace em `.kael/skills/<skill-name>/SKILL.md`.
- Parsing de frontmatter YAML + corpo Markdown do `SKILL.md`.
- Registro de skills disponiveis com metadados minimos para roteamento.
- Invocacao manual via `/<skill-name> [args]` no fast-path.
- Auto-invocacao por relevancia (descricao da skill no contexto, carga lazy do
  conteudo completo somente quando selecionada).
- Substituicao de argumentos no prompt da skill (`$ARGUMENTS`, `$0`, `$1`, ...).
- Telemetria operacional de skills no `/health`.

## Fora de escopo desta fase

- Subagentes (`context: fork`) para skills.
- Hooks de lifecycle por skill.
- Execucao de injecao dinamica via `!`command`` no `SKILL.md`.
- Marketplace/distribuicao externa de skills.

## Decisoes arquiteturais

1. **Skill como modulo de prompt, nao como tool**
   - Skill nao cria endpoint nem capability nova por padrao.
   - Skill injeta instrucoes no turno do agente quando invocada.

2. **Diretorio oficial inicial**
   - Path base: `.kael/skills`.
   - Estrutura canonica:
     - `.kael/skills/<skill-name>/SKILL.md` (obrigatorio)
     - arquivos auxiliares opcionais (templates, exemplos, scripts, referencias).

3. **Carregamento em dois niveis**
   - Nivel 1 (sempre): apenas catalogo resumido (nome + descricao + controles).
   - Nivel 2 (sob demanda): corpo completo do `SKILL.md` da skill escolhida.

4. **Politica de seguranca conservadora**
   - Maximo de 1 skill carregada por turno automaticamente.
   - `disable-model-invocation: true` impede auto-invocacao.
   - `user-invocable: false` remove skill do menu/comando direto.
   - `allowed-tools` (quando habilitado) so pode restringir, nunca ampliar
     permissoes alem da policy global do runtime.

## Desenho de componentes (proposto)

- `SkillDiscoveryService`
  - encontra skills validas em `.kael/skills`.
- `SkillParser`
  - parseia frontmatter e corpo; valida schema minimo.
- `SkillRegistry`
  - mantem snapshot de skills disponiveis para o turno.
- `SkillResolver`
  - resolve invocacao manual (`/<name>`) e auto-selecao por descricao/relevancia.
- `SkillPromptAssembler`
  - aplica substituicoes de argumentos e monta bloco final da skill.

Integracao principal:
- `ChatService` / `TurnOrchestrator`:
  - injeta catalogo de skills no contexto base;
  - carrega skill completa somente quando invocada/selecionada.

## Frontmatter inicial (MVP)

- `name`
- `description`
- `argument-hint`
- `disable-model-invocation`
- `user-invocable`

Campos para incremento posterior:
- `allowed-tools`
- `context`
- `agent`
- `model`
- `hooks`

## Observabilidade e operacao

Metricas previstas em `/health` (`metrics.skillsRuntime`):
- `enabled` (boolean)
- `skillsDiscovered`
- `manualInvocations`
- `autoInvocations`
- `invocationBlocked`
- `lastError`

## Pendencias da fase

1. Definir budget de caracteres do catalogo de skills por turno.
2. Definir formato canônico do bloco de skill no prompt do engine.
3. Definir comportamento de conflito de nomes entre skills.
4. Definir politica de discovery para monorepo (nested dirs) em incremento
   posterior, sem acoplar ao MVP.

## Entregas implementadas (incremento 18.0)

- `SkillService` adicionado ao core com discovery em `.kael/skills/<skill>/SKILL.md`.
- Parser inicial de frontmatter + corpo Markdown implementado.
- Invocacao manual via slash integrada no `ChatService`:
  - se skill existe e e invocavel pelo usuario, o turno segue para LLM com
    bloco de skill montado;
  - se `user-invocable: false`, retorno deterministico de bloqueio.
- Protecao de conflito com comandos operacionais:
  - nomes reservados (`/jobs`, `/help`, `/transcode`, etc.) nao sao
    interceptados por skills.
- Substituicao de argumentos no corpo da skill:
  - `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N`.
- Telemetria inicial de skills exposta em `/health`:
  - `metrics.skillsRuntime`.

## Entregas implementadas (incremento 18.1)

- Catalogo resumido de skills auto-invocaveis injetado no turno (`[available_skills]`)
  com budget de caracteres.
- Auto-invocacao conservadora:
  - maximo de 1 skill por turno;
  - selecao heuristica por relevancia entre mensagem e `name/description`.
- Respeito a `disable-model-invocation: true`:
  - skill fora do catalogo de auto-invocacao;
  - sem carga automatica de conteudo.
- Integracao no `ChatService`:
  - preparacao de mensagem de turno via `SkillService.prepareTurnMessage(...)`
    antes do preprocess multimodal e antes do turno LLM.

## Entregas implementadas (incremento 18.2)

- Parser de frontmatter reforcado no `SkillService`:
  - suporte a blocos multiline (`|` e `>`);
  - suporte a listas simples (`key:` + itens `- ...`);
  - suporte consistente a strings com aspas/colon.
- Parser segue intencionalmente enxuto (MVP) e orientado aos campos usados no runtime.
- Guia operacional de skills adicionado em `docs/skills.md` com:
  - estrutura de pastas em `.kael/skills`;
  - frontmatter suportado;
  - placeholders de argumentos;
  - regras/guardrails e telemetria.

## Entregas implementadas (incremento 18.3)

- Tuning configuravel por ENV para auto-invocacao:
  - `KAEL_SKILLS_CATALOG_MAX_CHARS`;
  - `KAEL_SKILLS_AUTO_MIN_SCORE`;
  - `KAEL_SKILLS_AUTO_MAX_PER_TURN`.
- Heuristica de relevancia refinada para reduzir falso-positivo:
  - filtro de mensagens curtas/genericas;
  - matching por prefixo para reduzir falso-negativo de variacoes de palavra.
- Prioridade de configuracao explicita:
  - opcoes passadas para `SkillService` prevalecem sobre ENV.
- Cobertura de testes expandida para tuning (threshold, budget, disable auto).

## Entregas implementadas (incremento 18.4)

- Telemetria de qualidade de auto-selecao adicionada em `skillsRuntime`:
  - `autoDecisionCounts` por motivo (`selected`, `below_threshold`, etc.);
  - `lastAutoDecision` com timestamp/motivo/skill;
  - `sessionAuto` com agregacao de sessoes rastreadas e sessoes com selecao.
- Tracking por sessao no `SkillService.prepareTurnMessage(...)` via `sessionKey`.
- Integracao no `ChatService` para repassar `sessionKey` ao preparar turno de skills.
- Novos testes cobrindo motivos de decisao e agregacao por sessao.

## Entregas implementadas (incremento 18.5)

- Skill `.kael/skills/project-knowledge-writer` adicionada para padronizar a escrita de notas na knowledge base do Kael.
- A skill orienta o agente a usar `knowledge_upsert` com:
  - `kind` (`fact|analysis|decision`);
  - `status`;
  - `confidence`;
  - `files`;
  - `evidence`.
- Referencias separadas foram adicionadas para:
  - schema recomendado de payload;
  - exemplos de nota confirmada, analise e conflito.
- Cobertura de testes expandida para auto-selecao da skill quando a mensagem pede para salvar achados de projeto.

## Entregas implementadas (incremento 18.6)

- Escopo explicito por projeto adicionado ao chat via marcador `@project-name`.
- Novo `ProjectContextService` cria e carrega `.kael/projects/<project>/PROJECT.md` como contexto local do workspace.
- Quando `@project` aparece:
  - o scaffold do projeto e provisionado automaticamente se ainda nao existir;
  - o `PROJECT.md` e injetado no turno;
  - a busca no project space passa a priorizar aquele projeto.
- Cobertura de testes adicionada para parser de `@project`, scaffold inicial e injecao de contexto no `ChatService`.

## Entregas implementadas (incremento 18.7)

- O conceito de `project space` foi consolidado em `.kael/projects/<project>/` com:
  - `PROJECT.md`;
  - `index.json`;
  - documentos Markdown tematicos adicionais.
- Novo conjunto de tools do agente adicionado:
  - `project_search`;
  - `project_get_document`;
  - `project_upsert_document`;
  - `project_list_documents`.
- A skill `project-knowledge-writer` foi ajustada para escrever no project space, em vez de depender exclusivamente de `knowledge_upsert`.
- O `ChatService` passou a usar o project space como fonte principal de retrieval para perguntas de projeto.

## Entregas implementadas (incremento 18.8)

- O marcador `@project` passou a gerar um bloco estruturado `[project_scope]` no turno do modelo com:
  - `project=<name>`;
  - mensagem limpa (`user_message=...`) sem o marcador inline.
- O `ChatService` agora remove `@project` da pergunta base enviada ao modelo quando o turno nao e uma invocacao manual de skill, reduzindo ruido textual.
- A skill `project-knowledge-writer` passou a tratar `[project_scope]` como fonte padrao de escopo para:
  - `project_list_documents`;
  - `project_get_document`;
  - `project_upsert_document`.

## Entregas implementadas (incremento 18.9)

- A criacao de novos documentos tematicos no project space passou a exigir autorizacao explicita:
  - `project_upsert_document` so cria um novo `.md` quando recebe `allowCreate=true`.
- O comportamento padrao agora e conservador:
  - atualizar arquivos existentes e reutilizar documentos tematicos ja indexados;
  - bloquear criacao silenciosa de novos arquivos.
- A skill `project-knowledge-writer` foi ajustada para pedir aprovacao do usuario quando concluir que um novo `.md` seria melhor do que atualizar um documento existente.

## Entregas implementadas (incremento 18.10)

- A superficie legada de `knowledge` foi removida do runtime principal:
  - sem namespace `knowledge` na engine;
  - sem tools PI `knowledge_*`;
  - sem endpoints `/knowledge/*` na API.
- O `project space` em `.kael/projects/<project>/` passa a ser a unica superficie persistida de conhecimento por projeto no core.

## Entregas implementadas (incremento 18.11)

- O enforcement estrutural para criar novos `.md` no project space foi removido do runtime.
- A politica passou a ser de prompt/skill:
  - preferir reutilizar documentos existentes;
  - confirmar com o usuario quando um novo arquivo parecer desejavel, sem tornar isso obrigatorio em todos os casos.
- `project_upsert_document` voltou a ser uma operacao simples de upsert, reduzindo burocracia no fluxo manual.

## Entregas implementadas (incremento 18.12)

- A API do core ganhou superficie dedicada para `project space`:
  - `GET /projects`
  - `GET /projects/:project`
  - `GET /projects/:project/documents`
  - `GET /projects/:project/document`
  - `POST /projects/:project/documents`
- O `ProjectContextService` passou a expor `listProjects()` para discovery de projetos fora do chat.
- A documentacao da API foi atualizada para refletir a nova superficie operacional de projetos.

## Entregas implementadas (incremento 18.13)

- O `ChatService` passou a injetar uma politica estruturada de documentos do project space quando ha `@project` no turno.
- Quando a mensagem menciona um arquivo `.md` junto com linguagem de pedido/confirmacao, o prompt agora recebe:
  - `[project_document_intent]`
  - `path=<arquivo>`
  - `state=requested|approved`
- A skill `project-knowledge-writer` foi ajustada para tratar esse bloco como a principal pista sobre criar ou atualizar um documento tematico.
