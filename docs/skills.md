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

Observacoes:
- `KAEL_SKILLS_AUTO_MAX_PER_TURN=0` desativa auto-invocacao.
- Invocacao manual por slash continua funcionando mesmo com auto desativada.
