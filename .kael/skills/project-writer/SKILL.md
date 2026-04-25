---
name: project-writer
description: Use when the task is to save, curate, or update project-specific knowledge inside a project space under `.kael/projects/<project>/`. Best for deciding whether to update `PROJECT.md` or create thematic Markdown documents such as `params.md`, `networking.md`, or `playback.md`.
argument-hint: "[project] [topic opcional]"
disable-model-invocation: false
user-invocable: true
---

Use this skill when the goal is to persist reusable project knowledge, not when the user only wants an answer in the current turn.

Workflow:
1. Read `.kael/skills/project-writer/references/schema.md`.
2. Read `.kael/skills/project-writer/references/editing-playbook.md`.
3. If needed, read `.kael/skills/project-writer/references/examples.md`.
4. Gather concrete evidence first:
   - file paths
   - code flow
   - endpoint or payload shape
   - uncertainty or conflicts
5. Inspect the current project space with:
   - `project_list_documents`
   - `project_get_document`
   - If `[project_scope]` is present in the turn context, reuse that `project=<name>` as the default project instead of inferring another one.
   - If `[project_document_intent]` is present, treat it as the strongest hint about the target `.md` and whether the user already requested or approved that file.
6. Decide whether to:
   - update `PROJECT.md` for stable project-level context
   - update an existing thematic document
   - propose creating a new thematic `.md` only when clearly better than reusing an existing file
7. Before writing, read the target document and decide if the change is:
   - section update
   - section append
   - full rewrite / curation pass

Editing policy:
- Prefer curating existing documents over blindly appending new blocks.
- If the target document already has a section for the same concept, update that section instead of creating a near-duplicate heading.
- If two sections are obviously overlapping, consolidate them in the new content instead of preserving both.
- Use `mode=replace` when the file needs cleanup, restructuring or section consolidation.
- Use `mode=append` only when you are clearly adding a genuinely new section that does not already exist in the file.
- When updating a document, preserve useful existing context that is still correct.
- When evidence is partial or conflicting, say so explicitly inside the Markdown instead of writing a falsely definitive statement.

Creation policy:
- Do not create a new `.md` silently.
- Prefer asking the user if a new file is desired before creating it.
- If a new file seems best, confirm briefly with the user when that would not make the flow unnecessarily bureaucratic.
- Use judgment: prefer updating an existing document unless a new thematic file is clearly better.

Required quality bar before `project_upsert_document`:
- Do not save vague summaries like "Android handles auth here".
- Prefer updating an existing file before creating a new one.
- Only create a new `.md` when the theme is clearly distinct and likely to recur.
- Prefer stable section names over ad hoc headings.
- Avoid duplicate sections such as `## Param X`, `## Parameter X`, `## X Header` when they describe the same fact.
- Prefer concise Markdown that future agents can scan quickly.
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

Preferred section shapes:
- For parameter/contract docs:
  - `## <Concept>`
  - short statement
  - `### Evidence`
  - optional `### Open Questions`
- For decision docs:
  - `## <Decision>`
  - decision statement
  - `### Context`
  - `### Evidence`
- For `PROJECT.md`:
  - preserve the top-level scaffold unless there is a strong reason to restructure the whole file

After writing:
- tell the user what file was updated
- include the project and path
- mention whether the file was reused or created now
