# Editing Playbook

Use this playbook before calling `project_upsert_document`.

## 1. Choose the right target

- Update `PROJECT.md` only for stable, project-wide context:
  - boundaries
  - key flows
  - important paths
  - conventions
- Use thematic files for narrower recurring knowledge:
  - `params.md`
  - `networking.md`
  - `playback.md`
  - `auth.md`
  - `decisions.md`

## 2. Read before writing

Always inspect the current target document first when it already exists.

Ask:
- does this file already cover the same concept?
- is there already a heading for this topic?
- would appending create duplication?
- does the file need curation rather than another appended section?

## 3. Decide `append` vs `replace`

Use `append` when:
- the file already has a clean structure
- the new information is a clearly new section
- no equivalent section already exists

Use `replace` when:
- you are updating an existing concept already present in the file
- you need to merge overlapping sections
- the file has become repetitive or inconsistent
- headings need normalization

## 4. Normalize headings

Prefer stable headings that future agents can match reliably.

Good:
- `## Session Id Header`
- `## Device Id Contract`
- `## Session Start Payload`

Avoid:
- `## Param x maybe`
- `## Another note about session id`
- `## More findings`

## 5. Evidence discipline

When a statement came from code inspection, include evidence:
- file paths
- classes/functions involved
- short explanation of the data flow

If confidence is partial:
- say what is confirmed
- say what remains uncertain

## 6. Consolidation rule

If the new finding overlaps an existing section:
- rewrite the section once with the best current version
- do not keep two sections that describe the same thing differently

## 7. User-facing behavior

When a new file seems best:
- prefer confirming briefly with the user if intent is not already clear
- if the user already requested or approved a specific `.md`, you can proceed

After updating:
- say which file was updated
- say whether it was reused, curated, or newly created
- mention major consolidation if you rewrote overlapping sections
