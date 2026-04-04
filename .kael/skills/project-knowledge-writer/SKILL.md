---
name: project-knowledge-writer
description: Use when the task is to save, curate, or update project-specific knowledge in Kael's knowledge base after code analysis, investigation, or architecture review. Best for turning findings into structured notes with evidence, files, confidence, and note kind.
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
4. Call `knowledge_upsert` with a structured note.

Required quality bar before `knowledge_upsert`:
- Do not save vague summaries like "Android handles auth here".
- Prefer one topic per note.
- `answer` must be directly reusable in a future question.
- Include `files` whenever the conclusion came from code.
- Include `evidence` as short factual bullets, not raw speculation.
- Set `kind`:
  - `fact`: confirmed implementation detail or behavior.
  - `analysis`: interpretation, reasoning, or likely explanation.
  - `decision`: agreed architecture or policy decision.
- Set `status`:
  - `curated` when evidence is strong.
  - `draft` when still provisional.
  - `conflicting` when sources disagree.
  - `stale` when likely outdated.
- Set `confidence` honestly.

Preferred note shape:
- `project`: stable project/app/domain name
- `topic`: narrow slug-like topic
- `kind`: `fact|analysis|decision`
- `title`: short human label
- `question`: optional question this note answers
- `summary`: optional 1-line summary
- `answer`: final reusable answer
- `files`: relevant file paths
- `evidence`: short bullets with the concrete support
- `tags`: compact retrieval hints
- `updatedBy`: agent name
- `source`: where the analysis came from

After writing:
- tell the user what note was saved
- include `noteId`
- mention if confidence is low or status is not `curated`
