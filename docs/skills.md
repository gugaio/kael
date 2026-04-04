# Skills no Kael (`.kael/skills`)

Guia operacional para criar e usar skills no workspace.

## Onde ficam

Skills do projeto devem ficar em:

`./.kael/skills/<skill-name>/SKILL.md`

Exemplo:

```text
.kael/
  skills/
    explain-code/
      SKILL.md
    review-pr/
      SKILL.md
```

## Como invocar

1. **Manual (slash):**
   - `/<skill-name> [args]`
   - Exemplo: `/explain-code src/chat/service.ts`

2. **Automatica (quando relevante):**
   - O Kael injeta um catalogo resumido de skills no turno.
   - Seleciona no maximo 1 skill automaticamente por mensagem.
   - Se uma skill tiver `disable-model-invocation: true`, ela nao entra na selecao automatica.

## Formato do `SKILL.md`

Cada skill pode ter frontmatter YAML + instrucoes em Markdown:

```yaml
---
name: explain-code
description: Explica codigo com analogias e fluxo.
argument-hint: "[arquivo] [nivel]"
disable-model-invocation: false
user-invocable: true
---

Ao explicar codigo:
1. Resuma o objetivo.
2. Mostre fluxo principal.
3. Aponte riscos.
```

Campos suportados no MVP:

- `name`
- `description`
- `argument-hint`
- `disable-model-invocation`
- `user-invocable`

## Placeholders de argumentos

No corpo da skill:

- `$ARGUMENTS` -> todos os argumentos
- `$ARGUMENTS[N]` -> argumento por indice (0-based)
- `$N` -> atalho de indice (`$0`, `$1`, ...)

Se a skill nao usar placeholders e for invocada com argumentos, o Kael adiciona:

`ARGUMENTS: <valor>`

## Parser de frontmatter (estado atual)

O parser suporta:

- `key: value`
- strings com aspas
- booleanos (`true`, `false`)
- blocos multiline (`|` e `>`)
- listas simples:
  - `key:`
  - itens `- valor`

Observacao:
- parser YAML e propositalmente limitado ao que o runtime precisa no MVP.

## Regras e guardrails

- Skills nao substituem comandos operacionais reservados (`/jobs`, `/help`, `/transcode`, etc.).
- `user-invocable: false` bloqueia invocacao manual por slash.
- Auto-invocacao e conservadora (no maximo 1 skill por turno).

## Telemetria

`GET /health` expõe `metrics.skillsRuntime` com:

- `enabled`
- `skillsDir`
- `skillsDiscovered`
- `manualInvocations`
- `autoInvocations`
- `invocationBlocked`
- `autoDecisionCounts` (motivos da decisao de auto-skill)
- `lastAutoDecision` (`at`, `reason`, `skillName`)
- `sessionAuto` (`trackedSessions`, `sessionsWithSelection`)
- `lastError`

## Configuracao por ENV (tuning 18.3)

- `KAEL_SKILLS_CATALOG_MAX_CHARS`
  - limite maximo de caracteres do bloco `[available_skills]`
  - default: `4000`
- `KAEL_SKILLS_AUTO_MIN_SCORE`
  - score minimo para auto-selecionar skill
  - default: `2`
- `KAEL_SKILLS_AUTO_MAX_PER_TURN`
  - maximo de skills auto por turno (atualmente efetivo para `0|1`)
  - default: `1`
- `KAEL_SKILLS_SESSION_STATS_LIMIT`
  - limite de sessoes rastreadas na telemetria de qualidade
  - default: `100`

Observacoes:
- `KAEL_SKILLS_AUTO_MAX_PER_TURN=0` desativa auto-invocacao.
- Invocacao manual por slash continua funcionando mesmo com auto desativada.

## Skill MCP (`mcporter`)

Foi adicionada:

- `.kael/skills/mcporter/SKILL.md`

Objetivo:

- orientar o Kael a operar servidores MCP pelo bridge `mcporter`, usando as
  tools nativas `mcp_list` e `mcp_call`.

Fluxo recomendado:

1. `mcp_list` sem argumentos para listar servidores disponiveis.
2. `mcp_list` com `server` + `schema=true` para inspecionar tools.
3. `mcp_call` com `target` e `argumentsJson` para executar a tool desejada.

Observacao da fase 19.1:

- `mcp_call` agora espera alias registrado no formato `server.tool`.
- Para MCPs `http` e `stdio`, registre primeiro o servidor via API (`POST /mcp/servers`)
  e aprove o uso quando surgir approval pendente.

Variaveis de ambiente da fase:

- `KAEL_MCP_ENABLED`
- `KAEL_MCP_BINARY`
- `KAEL_MCP_CONFIG_PATH`
- `KAEL_MCP_TIMEOUT_MS`
- `KAEL_MCP_MAX_OUTPUT_CHARS`
- `KAEL_MCP_ALLOW_HTTP`
- `KAEL_MCP_ALLOW_STDIO`

Guardrails:

- `http` e `stdio` ficam desabilitados por default.
- O caminho preferido do MVP e usar servidores ja configurados no `mcporter`.
- Quando houver bloqueio por policy, o agente deve explicar o bloqueio em vez de
  insistir por `exec`.

## Skill de diagnostico (recomendada)

Foi adicionada a skill:

- `.kael/skills/skill-routing-check/SKILL.md`

Como validar rapidamente:

1. Envie uma mensagem como:
   - `quero validar se o roteamento de skills foi correto`
2. Verifique se a resposta comeca com:
   - `[skill-routing-check]`
3. Verifique em `/health`:
   - `metrics.skillsRuntime.autoInvocations`
   - `metrics.skillsRuntime.lastAutoDecision`
   - `metrics.skillsRuntime.autoDecisionCounts`

## Skill Youbora (NPAW)

Foi adicionada:

- `.kael/skills/youbora/SKILL.md`
- `.kael/skills/youbora/scripts/query-youbora.mjs`

Variaveis esperadas no `.env`:

- `KAEL_YOUBORA_HOST`
- `KAEL_YOUBORA_ACCOUNT_CODE`
- `KAEL_YOUBORA_API_KEY`
- `KAEL_YOUBORA_DATE_TOKEN_TTL_MS` (opcional)

Exemplos de uso:

- `/youbora last24hours`
- `/youbora "2025-03-20 00:00:00" "2025-03-20 17:50:25" views vod hour`

## Skill hlsjs-config-advisor

Foi adicionada:

- `.kael/skills/hlsjs-config-advisor/SKILL.md`
- `.kael/skills/hlsjs-config-advisor/references/official-sources.md`
- `.kael/skills/hlsjs-config-advisor/references/parameter-catalog.md`
- `.kael/skills/hlsjs-config-advisor/references/parameter-interactions.md`
- `.kael/skills/hlsjs-config-advisor/references/analysis-playbook.md`

Objetivo:

- ajudar o agente a revisar configuracao do `hls.js` com base oficial, especialmente:
  - defaults;
  - `lowLatencyMode`;
  - `liveSyncDurationCount`;
  - `liveMaxLatencyDurationCount`;
  - `maxBufferLength`;
  - `backBufferLength`;
  - `maxBufferSize`;
  - `startLevel`.

Uso esperado:

- auto-selecao quando o usuario perguntar sobre tuning/defaults de `hls.js`;
- invocacao manual por slash:
  - `/hlsjs-config-advisor {"streamType":"live","goal":"low_latency"}`

Regra de qualidade:

- a skill deve partir do default como baseline e so recomendar override quando houver contexto e tradeoff claros.
