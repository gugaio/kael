# Worked Examples

## Example 1: add a narrow facts document

Use:

```json
{
  "project": "ios-app",
  "path": "params.md",
  "title": "Parameters and Contracts",
  "description": "Payloads, headers and request parameters used by the iOS app.",
  "tags": ["ios", "params", "contracts"],
  "content": "# Parameters and Contracts\n\n## Param x on session start\n\nO iOS envia o parametro `x` no corpo JSON de `/session/start` ao serializar `SessionStartRequest` antes do POST.\n\n### Evidence\n- `ios/App/Networking/SessionStartRequest.swift` declara a propriedade `x`.\n- `ios/App/Networking/SessionApi.swift` usa esse struct como body no endpoint `/session/start`.\n",
  "mode": "append"
}
```

Why:
- `params.md` is already the right thematic file
- this is a genuinely new section
- `append` is acceptable because the example assumes the file does not yet contain a section for this concept

## Example 2: update `PROJECT.md` with stable context

Use:

```json
{
  "project": "player-web",
  "path": "PROJECT.md",
  "title": "Project Overview",
  "description": "Visao geral, fluxos e convencoes do player web.",
  "tags": ["overview", "player", "web"],
  "content": "# player-web\n\n## Summary\nPlayer web responsavel por playback HLS e telemetria.\n\n## Key Flows\n- bootstrap do player\n- inicializacao do hls.js\n- coleta de playback events\n\n## Important Paths\n- `apps/web-player/src/player`\n- `apps/web-player/src/hls`\n- `apps/web-player/src/telemetry`\n",
  "mode": "replace"
}
```

Why:
- this belongs to project-wide context, not a narrow thematic file
- `replace` is better because `PROJECT.md` should stay curated and internally consistent

## Example 3: create a decision log

Use:

```json
{
  "project": "backend-api",
  "path": "decisions.md",
  "title": "Architecture Decisions",
  "description": "Decisoes de contrato e arquitetura do backend.",
  "tags": ["backend", "decisions", "contracts"],
  "content": "# Architecture Decisions\n\n## Device Id contract\n\nA leitura oficial de `deviceId` deve ocorrer via header `X-Device-Id`. Referencias antigas em query string devem ser tratadas como legado e removidas da documentacao operacional.\n\n### Evidence\n- `apps/api/src/http/device-middleware.ts` le `X-Device-Id` no middleware atual.\n- `docs/legacy/device-contract.md` ainda menciona query string e precisa ser corrigido.\n",
  "mode": "append"
}
```

Why:
- the information is a durable decision, not just a narrow implementation fact
- `decisions.md` is the right long-term target for this type of content

## Example 4: consolidate an existing section instead of appending a duplicate

Current `params.md` already contains:

```md
# Parameters and Contracts

## Session Id

Session id vai no request.
```

New finding:
- the exact header is `X-Session-Id`
- the value is injected in `SessionInterceptor.kt`

Prefer:

```json
{
  "project": "android-app",
  "path": "params.md",
  "title": "Parameters and Contracts",
  "description": "Headers, payloads and request parameters used by the Android app.",
  "tags": ["android", "params", "contracts", "headers"],
  "content": "# Parameters and Contracts\n\n## Session Id Header\n\nAndroid envia `sessionId` no header `X-Session-Id` dentro do interceptor usado por chamadas autenticadas.\n\n### Evidence\n- `apps/android/network/SessionInterceptor.kt` adiciona o header antes do request seguir.\n- O valor atual vem do `SessionStore` da sessao.\n",
  "mode": "replace"
}
```

Why:
- appending another section like `## Session Id Header` criaria duplicacao
- o melhor resultado e consolidar a secao existente numa versao mais precisa
