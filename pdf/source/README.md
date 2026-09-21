# Pressproof

Pressproof is a local-first pre-press PDF workspace built with React, TypeScript, Web Workers, WebAssembly, and MuPDF.js.

The production build is configured for deployment at `/pdf/` on the `waltonben.github.io` GitHub Pages site. Local development continues to run from `/`.

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

Coverage analysis, separation visibility, overprint controls, the Konva measurement layer, and report generation are intentionally reserved for later milestones.

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
