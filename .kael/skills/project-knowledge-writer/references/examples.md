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
