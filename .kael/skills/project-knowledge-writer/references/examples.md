# Worked Examples

## Example 1: confirmed fact from code

Use:

```json
{
  "project": "ios-app",
  "topic": "param-x-session-start",
  "kind": "fact",
  "title": "iOS param x on session start",
  "question": "Como o iOS envia o parametro x?",
  "summary": "iOS envia x no body de /session/start.",
  "answer": "O iOS envia o parametro `x` no corpo JSON de `/session/start` ao serializar `SessionStartRequest` antes do POST.",
  "files": [
    "ios/App/Networking/SessionStartRequest.swift",
    "ios/App/Networking/SessionApi.swift"
  ],
  "evidence": [
    "SessionStartRequest declara a propriedade x.",
    "SessionApi usa esse struct como body no endpoint /session/start."
  ],
  "tags": ["ios", "session", "api"],
  "status": "curated",
  "confidence": 0.93,
  "updatedBy": "codex",
  "source": "code-analysis"
}
```

## Example 2: architecture reasoning, not a fact

Use:

```json
{
  "project": "player-web",
  "topic": "abr-oscillation-root-cause",
  "kind": "analysis",
  "title": "Likely cause of ABR oscillation",
  "question": "Por que o player web esta oscilando nivel com frequencia?",
  "summary": "A configuracao de buffer parece agressiva para a rede observada.",
  "answer": "A oscilacao de ABR parece mais consistente com buffer curto e throughput instavel do que com erro estrutural do manifest. A configuracao atual reduz a margem de recuperacao apos cada troca.",
  "files": [
    "apps/web-player/src/hls/config.ts"
  ],
  "evidence": [
    "O player usa overrides de buffer mais agressivos que o default.",
    "Nao houve evidencias de erro fatal ou variant faltando no manifest analisado."
  ],
  "tags": ["web", "player", "abr", "analysis"],
  "status": "draft",
  "confidence": 0.68,
  "updatedBy": "codex",
  "source": "log-review"
}
```

## Example 3: unresolved conflict

Use:

```json
{
  "project": "backend-api",
  "topic": "device-id-source",
  "kind": "fact",
  "title": "Backend device id source is conflicting",
  "question": "De onde o backend le deviceId?",
  "summary": "Ha conflito entre o controller atual e documentacao antiga.",
  "answer": "A implementacao atual indica leitura de `X-Device-Id` no middleware, mas existe documentacao antiga apontando query param `deviceId`. A nota permanece conflitante ate validacao end-to-end.",
  "files": [
    "apps/api/src/http/device-middleware.ts",
    "docs/legacy/device-contract.md"
  ],
  "evidence": [
    "O middleware atual le X-Device-Id do header.",
    "A documentacao antiga ainda menciona deviceId na query string."
  ],
  "tags": ["backend", "headers", "contracts"],
  "status": "conflicting",
  "confidence": 0.56,
  "updatedBy": "codex",
  "source": "code-and-doc-review"
}
```
