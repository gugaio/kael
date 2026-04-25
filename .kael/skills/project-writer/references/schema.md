# Project Space Writer Schema

Use `project_upsert_document` with this contract:

```json
{
  "project": "android-app",
  "path": "params.md",
  "title": "Parameters and Contracts",
  "description": "Headers, payloads and request parameters used by the Android app.",
  "tags": ["android", "params", "contracts", "headers"],
  "content": "# Parameters and Contracts\n\n## Session Id Header\n\nAndroid envia `sessionId` no header `X-Session-Id` dentro do interceptor de rede usado por chamadas autenticadas.\n\n### Evidence\n- `apps/android/network/SessionInterceptor.kt` adiciona o header antes do request seguir.\n- O valor vem do `SessionStore` atual.\n",
  "mode": "append"
}
```

Important:
- `content` is the full payload that will be written by the tool.
- If you are fixing or consolidating an existing section, prefer preparing the curated final content and using `mode=replace`.
- Do not use `append` as a default just because it is easier.

Field guidance:
- `project`: use a stable bucket like `android-app`, `ios-app`, `backend-api`, `player-web`.
  - If the turn already includes `[project_scope] project=<name>`, reuse that same project by default.
- `path`: use `PROJECT.md` for overview or a stable thematic file like `params.md`, `networking.md`, `playback.md`, `decisions.md`.
- `title`: human-readable title for `index.json`.
- `description`: concise purpose of the file.
- `tags`: retrieval hints.
- `content`: the Markdown body to write.
- `mode`:
  - `replace` when curating/restructuring the whole file.
  - `append` when adding a new section to an existing document.

When not to write:
- when the conclusion is only a guess
- when there is no reusable Markdown content yet
- when you have not checked whether an existing project document already fits the topic

Document selection policy:
- prefer `PROJECT.md` for stable context shared by the whole project
- prefer thematic documents for narrow recurring knowledge
- avoid creating many tiny files when an existing thematic document is a better fit
- when a new file seems best, prefer confirming that direction with the user unless the intent is already clear

Editing policy:
- if the same concept already exists in the file, update it instead of appending a second section
- if the file contains overlapping headings, consolidate them in the new content
- prefer `replace` for curation and `append` only for genuinely new sections
