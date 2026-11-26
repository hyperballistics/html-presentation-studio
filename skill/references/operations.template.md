# Operations

Use this reference only when the target workspace's own documentation does not answer a command or lifecycle question.

## Commands

Run from the target workspace root:

```sh
npm run check                 # structure, model, projection, fonts
npm test                      # temporary-copy integration tests
npm start -- --port <port>    # local-only workbench
npm run export -- html --out <directory>
npm run export -- pdf --out <file.pdf>
```

The server binds to loopback only. Keep one writer per workspace and do not proxy it.

## Draft Conflicts and Text Color

- On a conflicted page, the workbench opens the latest saved source in read-only mode. The banner identifies the workspace and page and shows the draft base and disk revision with their source modification times. Older drafts without recorded base times show an unknown time. Use **处理版本冲突** to switch between **查看最新源文件** and **查看旧草稿** while preserving the draft. **另存草稿副本** exports the draft regardless of the preview. Direct writeback remains blocked during a conflict. Discard only with the author's explicit confirmation.
- For partial text color, select a text box and highlight the characters under **属性 → 文本**. Choose a color and click **应用颜色**, or use **恢复默认** to let the selected characters inherit the box color. The color ranges live in `slide-model` and carry through playback and export. Check the target workbench supports this field before writing it to an existing workspace.

## Written-back Context

In workspaces that support `npm run context`, successful source writes, named checkpoints and outline changes refresh `.runtime/context/PAGE-FACTS.md` rather than rewriting editorial Markdown. Run `npm run context -- check` before cross-page handoff; if the cache is missing or stale, run `npm run context -- sync`. In the editor, use **同步上下文** next to **写回源文件** to do the same check and refresh, with a pending-review count. Neither workflow approves a storyline or reads browser drafts. `check` can pass with pages still awaiting review.

If a page is flagged, compare its written-back entity with its `STORYLINE.md` row and relevant `section.md`. Update only affected summaries, flow and context. The author can record confirmation with `npm run context -- review "<page-id>"`. Visual changes may still alter meaning even without an automated flag. The cache and confirmation records are local; regenerate the cache in copied workspaces. If the refresh fails after a source write, fix the cause then sync again; do not repeat the source write just to rebuild the cache. In older workspaces without this command, compare targeted entities and editorial pointers manually rather than upgrading the workspace implicitly.

## Failure Handling

- If tests cannot listen on loopback because of sandbox policy, rerun with narrowly scoped escalation; do not rewrite tests to avoid the permission.
- If the structural check fails, treat the listed page or manifest as the actual target. Do not modify generated display HTML directly.
- If an export directory is incomplete, choose another destination or let the user remove it explicitly. Do not silently overwrite.
- If a write lock remains after a crash, first confirm no writer is running and preserve the runtime directory before handling the empty lock.

## Scope

The workspace is not a PPTX reader/writer, arbitrary DOM importer, cloud service, or multi-user editor. Do not add those capabilities during an ordinary presentation task.
