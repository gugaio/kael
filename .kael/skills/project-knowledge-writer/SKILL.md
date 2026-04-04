---
name: project-knowledge-writer
description: Use when the task is to save, curate, or update project-specific knowledge inside a project space under `.kael/projects/<project>/`. Best for deciding whether to update `PROJECT.md` or create thematic Markdown documents such as `params.md`, `networking.md`, or `playback.md`.
argument-hint: "[project] [topic opcional]"
disable-model-invocation: false
user-invocable: true
---

Use this skill when the goal is to persist reusable project knowledge, not when the user only wants an answer in the current turn.

Workflow:
1. Read `.kael/skills/project-knowledge-writer/references/schema.md`.
2. If needed, read `.kael/skills/project-knowledge-writer/references/examples.md`.
3. Gather concrete evidence first:
   - file paths
   - code flow
   - endpoint or payload shape
   - uncertainty or conflicts
4. Inspect the current project space with:
   - `project_list_documents`
   - `project_get_document`
5. Decide whether to:
   - update `PROJECT.md` for stable project-level context
   - update an existing thematic document
   - create a new thematic `.md` and register it through `project_upsert_document`

Required quality bar before `project_upsert_document`:
- Do not save vague summaries like "Android handles auth here".
- Prefer updating an existing file before creating a new one.
- Only create a new `.md` when the theme is clearly distinct and likely to recur.
- Include concrete file paths and evidence in the Markdown content whenever the conclusion came from code.
- Keep `PROJECT.md` for overview, boundaries, key flows and conventions.
- Use thematic files for narrower domains:
  - `params.md`
  - `networking.md`
  - `playback.md`
  - `auth.md`
  - `decisions.md`

Preferred document metadata:
- `project`: stable project/app/domain name
- `path`: `PROJECT.md` or a thematic file like `params.md`
- `title`: short human label
- `description`: what this file is for
- `tags`: compact retrieval hints
- `content`: Markdown content that future agents can read directly

After writing:
- tell the user what file was updated
- include the project and path
- mention whether the file was reused or created now
