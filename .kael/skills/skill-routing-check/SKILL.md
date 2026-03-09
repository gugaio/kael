---
name: skill-routing-check
description: Diagnostica se o roteamento de skills foi correto para a mensagem atual. Use quando o usuario quiser validar auto-selecao de skill, checar relevancia da escolha, ou depurar por que uma skill foi (ou nao foi) aplicada.
argument-hint: "[contexto-opcional]"
---

Quando esta skill for aplicada, siga este formato:

1. Comece a resposta com o marcador exato: `[skill-routing-check]`.
2. Explique em 1-2 linhas por que esta skill e relevante para a mensagem.
3. Diga explicitamente:
   - `match`: `alto`, `medio` ou `baixo`
   - `motivo`: quais tokens/intencoes bateram com a skill
4. Se o usuario passar argumentos (`$ARGUMENTS`), inclua um bloco `contexto` com eles.
5. Feche com uma recomendacao pratica de proximo teste para validar roteamento.

Se houver argumentos, use:

- contexto: `$ARGUMENTS`

Mantenha objetivo e curto.
