# Project Knowledge Writer Schema

Use `knowledge_upsert` with this contract:

```json
{
  "project": "android-app",
  "topic": "session-id-header",
  "kind": "fact",
  "title": "Android session id header",
  "question": "Como o Android envia o sessionId?",
  "summary": "Android envia sessionId no header X-Session-Id.",
  "answer": "Android envia `sessionId` no header `X-Session-Id` dentro do interceptor de rede usado por chamadas autenticadas.",
  "files": ["apps/android/network/SessionInterceptor.kt"],
  "evidence": [
    "O interceptor adiciona o header X-Session-Id antes do request seguir.",
    "O valor vem do SessionStore atual."
  ],
  "tags": ["android", "network", "headers", "session"],
  "status": "curated",
  "confidence": 0.92,
  "updatedBy": "codex",
  "source": "code-analysis"
}
```

Field guidance:
- `project`: use a stable bucket like `android-app`, `ios-app`, `backend-api`, `player-web`.
- `topic`: keep it narrow and slug-like. Good: `session-id-header`. Bad: `networking`.
- `kind`:
  - `fact`: confirmed implementation detail.
  - `analysis`: explanation, inference, risk, or diagnosis.
  - `decision`: architecture decision or agreed contract.
- `summary`: one-line retrieval summary.
- `answer`: write for future reuse. It should stand alone.
- `files`: use repo-relative paths when possible.
- `evidence`: 1-4 short bullets.
- `status`: prefer `curated` only when the evidence is explicit.
- `confidence`: use a real number from `0` to `1`.

When not to write:
- when the conclusion is only a guess
- when the topic is too broad
- when there is no reusable answer yet

Conflict policy:
- if a new finding contradicts an old one and you cannot resolve it, write the note as `conflicting`
- state both sides in `answer`
- make the uncertainty explicit in `evidence`
