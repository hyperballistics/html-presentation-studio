# Verification

Use this reference only when HTML UI, layout, interaction, player behavior, or an exported artifact must be checked visually.

## Required Checks

1. Run the closest non-visual validation first:

   ```sh
   npm run check
   ```

2. Start the local workbench with an available loopback port.

3. Open the printed local address and verify the actual target state, not merely that a page loads.

## What To Verify

- Target pages render without overlap, clipped controls, blank canvases, or broken assets.
- Interaction relevant to the change works: selection, edit, layer movement, player navigation, or animation as applicable.
- For editor page navigation, use a temporary multi-page copy: verify button and arrow-key navigation across sections, first/last limits, object nudging when selected, and draft recovery on return. Keep the bundled single-page example unchanged.
- Verify page deletion in a temporary copy: cancel, last-page guard, draft guard, fallback page, and source backup. Verify that the right-hand Properties panel shows alignment for multiple selections only, then check alignment against the selection bounds, group preservation, and undo.
- When changing marquee selection, start a drag in the editor margin, extend it past the canvas edge, and verify that preview and selection agree. Check cancellation and scrolling at a zoom level that clips the slide.
- When changing object duplication or clipboard behavior, verify that a copy near the lower-right corner visibly offsets. In a temporary two-page copy, paste from the toolbar and immediately after clicking the destination in the outline. Check that images, groups and internal connectors survive, external endpoints detach, and undo removes the pasted objects.
- Narrow and wide desktop viewports behave as intended; check mobile layout only when the change affects it.
- For conditional export, combine a section, individual pages, and a page range. Verify deduplication and outline order. Open the multi-page HTML offline and check page navigation and embedded fonts.
- Open exported HTML/PDF when the task concerns export fidelity. For mixed formats, check the PDF page count, order, and individual page sizes (e.g. `pdfinfo -f 1 -l <page-count>`). Check fit and a zoom level that requires scrolling; zoom must not change source geometry.

Report verification as separate layers:

- Structural check: command and result.
- Browser check: what was viewed and what passed.
- Human visual acceptance: pending unless the user explicitly accepted it.

Do not claim a layout is final from code review alone.
