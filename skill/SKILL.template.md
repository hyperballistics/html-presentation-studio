---
name: html-presentation-studio
description: Create, edit, review, or export portable HTML presentation workspaces when a task needs local HTML slides, a structured slide-model source, agent-safe writeback, or deterministic HTML/PDF delivery. Do not use for ordinary websites, apps, PPTX authoring, or documents that do not need this workspace contract.
metadata:
  short-description: Build portable HTML presentation workspaces
---

# HTML Presentation Studio

This skill uses a portable local workspace as the content authority. Do not load the full template by default; route by task type.

## Routing

- **Create a new workspace:** read `references/new-workspace.md`, then copy the bundled template into a task-owned directory. Do not edit the skill's source copy.
- **Edit, review, or export an existing workspace:** read the target workspace's `AGENTS.md` first, then only the files it points to for that task.
- **Agent-mediated object edits:** read the target workspace's `agents/protocol.md` and the specified request receipt. Do not scan the whole project or apply writeback without human approval.
- **Cross-page handoff or narrative drift:** use the target workspace’s context check when supported. Read generated page facts only if needed; use `STORYLINE.md` for author intent and the target page for written-back content. Do not mark someone else’s narrative as reviewed.
- **Browser or layout verification:** read `references/verification.md` only when UI, layout, interaction, or export output must be checked visually.
- **Operational details and troubleshooting:** read `references/operations.md` only when the target workspace's own documentation does not answer the command or lifecycle question.

## Invariants

- The target workspace owns its data. The skill template is only a starting point.
- `slide-model` is the sole content maintenance source; display HTML is a projection.
- Keep the workbench local and single-instance. Do not expose it to a network.
- Prefer the smallest useful file set and report exactly what was verified.

## Asset

The reusable template is stored under `assets/html-presentation-studio-template`. Never modify it as user content; copy it to a task-owned directory first.

For packaging, installation, invocation policy, and progressive-disclosure rules, read `SHARING.md` only when maintaining or sharing the skill itself.
