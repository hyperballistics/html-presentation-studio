# New Workspace

Use this reference only when creating a new portable HTML presentation workspace from the bundled template.

## Template

Source: `assets/html-presentation-studio-template`, resolved relative to the Skill folder.

The bundled template is the Skill's maintenance source. Do not edit it, generate into it, or run a long-lived service inside it.

## Procedure

1. Choose a task-owned destination. Ask only when the destination materially affects ownership or integration; otherwise use a clearly named new directory in the task workspace.
2. Copy the entire template directory to the destination. Keep required font licenses.
3. Work only inside the destination from that point onward.
4. Read the destination's `AGENTS.md`, `README.md`, and, when narrative matters, `STORYLINE.md`. Choose each page’s format and paper orientation before laying out content. The bundled workbench supports mixed page formats in one deck; its view zoom is not a content setting.
5. Follow the destination's own rules for sections, page IDs, model maintenance, and writeback.

## Minimal Commands

Run from the destination workspace root:

```sh
npm run check
npm test
npm start
```

If only content initialization is needed, defer browser and export testing until content exists. If UI behavior changed or the user must approve layout, follow `verification.md`.
