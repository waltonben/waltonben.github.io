# Pressproof

Pressproof is a local-first pre-press PDF workspace built with React, TypeScript, Web Workers, WebAssembly, and MuPDF.js.

Local development and preview builds run from `/`. To prepare a GitHub Pages build for the existing `/pdf/` subdirectory, use `npm run build -- --base /pdf/`.

## Implemented milestones

### Milestone 1 — local rendering

- Drag-and-drop and file-picker PDF upload.
- Transfer of the source `ArrayBuffer` into a dedicated Web Worker.
- MuPDF WebAssembly document loading and first-page rendering off the main thread.
- Transferable RGBA pixel buffers painted onto the bottom canvas.
- Responsive high-DPI rendering with stale-request protection and pixel limits.
- In-memory lifecycle only; replacing, closing, or refreshing discards the document.

### Milestone 2 — color preflight

- PDF/X declaration and OutputIntent inspection, including detection of declaration-only files with no document profile.
- Embedded object-profile discovery, including ICC description and version.
- Observed document classification as CMYK, RGB, Gray, Mixed, or Unknown.
- Color-space inventory from MuPDF's interpreted page drawing operations.
- Used named-separation discovery for vector, text, image-mask, and transparency operations.
- Declared-but-unused ink discovery from PDF/X MixingHints metadata.
- Process and technical/spot separation display.
- Warnings for RGB-only process artwork and named separations with RGB alternate color spaces.
- Click-to-sample rendered CMYK or RGB channel values and physical page coordinates.

### Milestone 3 — ink coverage and separation preview

- Worker-side page-one coverage analysis at 72 dpi.
- Mean tint percentage for every CMYK, spot, and technical separation.
- Equivalent 100% solid-ink area in square millimetres.
- Coverage values shown alongside the existing process-first separation list.
- Deterministic cleanup of MuPDF callback objects so analysis cannot invalidate the active document.
- Per-separation visibility controls for process, spot, and technical inks.
- One-click Solo isolation and Show all reset controls.
- Worker-side process/spot plate caching at the current render scale for responsive repeated toggles.
- Clear filtered-proof state with composite pixel sampling paused until all inks are restored.

The current named-ink analysis covers vector paths, text, and image masks. Gradient/shading spot plates and multichannel spot images need the planned lower-level separation API. Filtered views are plate previews rather than production overprint simulation; overprint controls, the Konva measurement layer, and report generation remain for the following slices.

## Run locally

```sh
npm install --cache ./work/npm-cache
npm run dev
```

Build and lint:

```sh
npm run build
npm run lint
```

## Licensing

The `mupdf` package is distributed under AGPL-3.0-or-later and commercial licensing terms. Confirm that the chosen license is compatible with the intended product before distribution.
