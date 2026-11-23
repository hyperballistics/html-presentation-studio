# Sharing and Configuration Guide

Use this reference only when maintaining or sharing the Skill itself. Keep the content template-oriented and portable.

## Skill Package Layout

```text
html-presentation-studio/
├── SKILL.md
├── SHARING.md
├── agents/openai.yaml
├── references/
│   ├── new-workspace.md
│   ├── operations.md
│   └── verification.md
└── assets/
    └── html-presentation-studio-template/
```

`SKILL.md` is the only instruction file loaded automatically. Reference files are task-scoped. The bundled template is an asset, not an instruction source.

## Configuration

Configure user-facing metadata and invocation policy in `agents/openai.yaml`:

```yaml
interface:
  display_name: "HTML Presentation Studio"
  short_description: "Create and verify portable HTML slide workspaces"
  default_prompt: "Use $html-presentation-studio to create or edit a portable HTML presentation workspace."

policy:
  allow_implicit_invocation: true
```

`allow_implicit_invocation: true` lets matching tasks select the Skill automatically. Keep it enabled for reusable workflows. Set it to `false` only when the owner explicitly requires `$html-presentation-studio` invocation.

Do not encode this workflow in global agent instructions or broad tool configuration. The Skill is the better surface because it carries its own routing, assets, and task-scoped references.

## Invocation Rules

- Use the Skill for portable HTML presentation workspace tasks: creation, model-based editing, review, export, verification, or agent-mediated single-object proposals.
- Use `$html-presentation-studio` for explicit invocation.
- Copy the bundled template to a task-owned directory before editing user content.
- For an existing workspace, follow that workspace's `AGENTS.md` and load only the files it points to.
- Do not expose the workbench to a network, run multiple writers, or automatically approve writeback.
- Treat the user as the final approver of content, layout, and source mutation.

Do not use the Skill for ordinary websites, applications, PPTX authoring, unrelated HTML generation, or documents that do not need the workspace contract.

## Progressive Disclosure

1. Codex sees only the Skill name and description.
2. When selected, it loads only `SKILL.md` for routing and invariants.
3. It reads one task reference only when that task occurs:
   - `new-workspace.md` for creating a workspace;
   - `operations.md` for unresolved command or lifecycle questions;
   - `verification.md` for visual or export checks.
4. For existing workspaces, it follows the target `AGENTS.md`, manifest, narrative index, target page, or request receipt as needed.
5. It does not read the entire bundled template as context; it copies the asset when a new workspace is needed.

## Packaging Rules

- Distribute the Skill folder as a self-contained archive.
- Keep fonts and their licenses together.
- Exclude `.runtime/`, `.agent-state/`, caches, build outputs, logs, local checkpoints, private histories, and generated exports.
- Do not include machine-specific absolute paths, environment values, credentials, or private project content.
- Keep the bundled example generic and replaceable.
- Record the HTML Studio version in the template package metadata, not in global instructions.

## Acceptance Checks

After packaging or installation:

1. Validate the Skill frontmatter and invocation policy.
2. Copy the bundled template to a clean temporary directory.
3. Run the structural check command.
4. Run integration tests when tool permissions allow.
5. Report separately: skill validation, template self-test, browser/visual verification when required, and remaining human acceptance.

If a check cannot run, state the exact reason and residual risk instead of claiming success.
