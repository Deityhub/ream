# Ream

PDF and image tools that run entirely on your device, in the browser or as an Electron app. Own engines, no runtime dependencies in phase 1.

```bash
yarn dev          # web app on http://localhost:5173
yarn desktop      # build, then open in Electron
yarn test         # vitest
yarn typecheck
yarn pdf <cmd>    # dev CLI for pdf-core: info | merge | extract | remove | rotate | split
```

## Layout

| Path | What |
|---|---|
| `packages/core` | Tool manifest types |
| `packages/pdf-core` | Own PDF parser, writer and page operations (pure TS, no DOM) |
| `packages/image-core` | RGBA pixel buffer, resize/crop/rotate/flip/stitch, own PNG codec, browser codec |
| `packages/ui` | Theme tokens and shared React components |
| `packages/tools` | One folder per tool, plus the registry |
| `apps/web` | Vite + React + Tailwind v4 |
| `apps/desktop` | Electron shell |

## Roadmap

| # | Milestone | Contents |
|---|---|---|
| M0 ✅ | Skeleton | Monorepo, UI shell, registry, Electron |
| M1 ✅ | PDF core | Parser, writer; merge, split, rotate, remove/extract pages |
| M1.5 ✅ | Tool runtime | `run()` contract, Web Worker execution, progress/cancel, result card (download, ZIP, use in another tool), readable errors, size limits, Electron save dialog. Merge PDF is the first end-to-end tool |
| M2 ✅ | Image core | Pixel buffer, browser codec seam; resize, crop, rotate/flip, convert, stitch |
| M3 | PDF edit | Images → PDF, page numbers, watermark, crop, metadata, extract images |
| M4 | Own codecs | PNG/GIF/BMP/JPEG; image compress, PDF lossless compress, animated GIF, EXIF |
| M5 | PDF security | Encrypt/decrypt, visual signature |
| M6 | Image edit | Watermark, manual blur, filters, meme |
| M7 | PDF advanced | Organize grid, flatten, repair, forms, PDF → text/Markdown, TTF embedding, bookmarks |
| M8 | Ship | PWA, packaging, signing, auto-update, CI on 3 OSes |
| Gate | Phase 2 | Decide per feature: PDF renderer, OCR, Office/HTML → PDF, PDF/A, ML image tools |

Cross-cutting: grow the PDF test corpus (`packages/pdf-core/test/fixtures`), check accessibility on every new page.

## Known M1 limits

- Merge and page operations drop bookmarks, AcroForm fields and named destinations; links to dropped pages become dead (M7).
- Encrypted PDFs are refused with a clear message (M5).
- Electron save dialog: the Download button relies on Chromium's default download prompt; not yet checked by hand.
- Streams other than Flate are copied through untouched but can't be decoded yet (only needed for xref/object streams).
- All objects are parsed up front; make parsing lazy if very large files become a problem.

## Known M2 limits

- JPEG, WebP and GIF go through the browser's codecs (OffscreenCanvas in the worker); our own codec reads and writes PNG only until M4. Animated GIFs lose their animation (first frame only).
- HEIC, TIFF, RAW and SVG inputs are not accepted yet.
- Our own PNG decoder rejects interlaced files; the browser codec handles them.
- Crop is drag-to-select with mouse or touch, plus numeric fields for keyboard use.
- Checked in Electron (Chromium) only; Safari and Firefox are untested.
