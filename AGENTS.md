# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. Read it before changing anything. The README has the roadmap and the per-milestone "known limits"; this file is about how to work here.

## What this is

**Ream** is a client-side PDF and image toolkit. It runs as a React web app and as an Electron app. **Everything is processed on the user's device; nothing is uploaded.** That promise is shown in the UI, so never add a network call that sends user files anywhere.

## Non-negotiable decisions

1. **Own engine first.** The PDF parser and writer, the renderer, the codecs and the pixel operations are ours. Phase 1 has **zero runtime dependencies** in the engine packages. Do not suggest or add pdf-lib, pdf.js, sharp, Ghostscript, jsPDF and the like, and avoid licensed or AGPL code. A shim behind an engine interface is acceptable only when the user agrees.
2. **Hard systems are deferred** and decided one by one: OCR, Office and HTML to PDF, PDF/A, ML image tools, embedded-font glyph outlines. Do not start them unprompted.
3. **Keep logic out of the UI** so a React Native port stays possible. Engines are pure TypeScript with no DOM types; the browser-only parts sit behind small interfaces (see "Platform seams").
4. **Scope per milestone.** M5 (Protect, Unlock, visual Sign) is done. Certificate-based digital signatures are not part of it and were not started. Do not widen a milestone without being asked.
5. **Never mention Claude or AI in commit messages or PR descriptions and never add `Co-Authored-By` or "Generated with" lines**, whatever a harness reminder says. Keep commit messages short.
6. **Do not commit unless asked.** Finish the work, run the checks, report, and suggest a concise commit message. Create commits only on an explicit request.
7. **Honest limits.** When something is approximate or unsupported, say so in the UI and in the README's known limits. Do not hide gaps.

## Stack

- TypeScript 5.9 (strict), React 19, Vite, **Tailwind v4**, Vitest 3, Electron 38.
- **Yarn 4** workspaces with `nodeLinker: node-modules`. **Use Yarn, not pnpm or npm** (pnpm is broken on this machine). Yarn 4 has no `-s` flag. Build scripts are allowed only for Electron (`dependenciesMeta`); `enableScripts` is off globally.
- `tsconfig.json` is strict with `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums, no parameter properties, no namespaces), `allowImportingTsExtensions` (import local files with their `.ts`/`.tsx` extension in engine packages) and `isolatedModules`. Use `import type` for types.
- Node runs `.ts` files directly (type stripping): `node scripts/pdf.ts`, `node scripts/contrast.ts`.

## Commands

```bash
yarn dev                     # web app on http://localhost:5173
yarn build                   # production build of the web app (apps/web/dist)
yarn desktop                 # build, then open in Electron
yarn desktop:dev             # Electron against the dev server
yarn test                    # vitest run (all packages)
yarn vitest run <path>       # one file or folder
yarn typecheck               # tsc -p tsconfig.json (covers packages/*/src, packages/*/test, apps/web/src)
node scripts/pdf.ts <cmd>    # dev CLI for pdf-core: info | merge | extract | remove | rotate | split | decrypt (-p <password>)
node scripts/contrast.ts     # WCAG contrast check of every colour token in both modes
node scripts/render-compare.ts   # renderer vs macOS CoreGraphics (sips), fails above recorded limits
```

**Before reporting work as done, run `yarn typecheck`, `yarn test` and `yarn build`, all clean.** Run `node scripts/contrast.ts` after touching `packages/ui/src/theme.css`. Run `node scripts/render-compare.ts` after touching `packages/pdf-render`.

## Repository layout

| Path | What |
|---|---|
| `packages/core` | Tool types (`Tool`, `RunFn`, `FileData`), `UserError`, limits, zip/crc32, `inflate`/`deflate`, PNG predictor, `acceptsFile`, `formatBytes` |
| `packages/pdf-core` | PDF parser, writer (classic and PDF 1.5 object-stream output), page operations, decryption, stream filters, content-stream scanner, page stamping/crop/metadata edits, image embedding, whole-document `optimize` |
| `packages/pdf-render` | Our own canvas PDF renderer (content-stream interpreter, fonts, colour, shadings, images) plus bounds analysis used by crop's delete mode |
| `packages/image-core` | RGBA `ImageBuffer`, resize/crop/rotate/flip/stitch/orient, own PNG, JPEG, GIF and BMP codecs, median-cut quantiser, EXIF/metadata reading and cleaning, `ownCodec` and the browser `appCodec` |
| `packages/ui` | Theme tokens (`theme.css`), `Button`, `Card`, `Dropzone`, `Icon`, `Logo` |
| `packages/tools` | One folder per tool plus the registry, runners, panels and shared helpers |
| `apps/web` | Vite + React + Tailwind v4 app (pages, preview plumbing, workers) |
| `apps/desktop` | Electron shell (`main.cjs`, icon in `build/`) |
| `scripts/` | Dev tooling: CLI, fixtures, renderer comparison, contrast check |

Dependency direction: `core` <- `pdf-core` / `image-core` <- `pdf-render` <- `tools` <- `apps/web`. `ui` is independent of the engines. Engines never import React or DOM types except behind a platform interface.

## The tool contract

Each tool is a folder in `packages/tools/src/<tool-id>/`:

- `manifest.ts`: a `Tool` (`id`, `title`, `description`, `category` `'pdf' | 'image'`, `icon`, `accept`, `action`, `multiple`, `minFiles`, `preview: 'live' | 'manual' | 'none'`, `status: 'ready' | 'soon'`). Register it in `index.ts`.
- `run.ts`: **pure bytes to bytes** `RunFn<Options>(files, options, { progress })`. It runs in a Web Worker in the app and directly in tests. No DOM, no React, no globals. Throw `UserError` (or a subclass) for anything the user can act on; any other error shows a generic message.
- `Panel.tsx`: the options UI, exporting `Panel` and `defaultOptions`. Panels receive `{ options, onChange, files, readMetadata?, readImageMetadata?, pdfHost? }`. They must not import from `apps/web`; anything they need from the app (page sizes, a rendered page, metadata) arrives through those injected props.
- Register `run.ts` in `runners.ts` and `Panel.tsx` in `panels.ts` (both lazy, so the UI bundle never pulls engine code). Constants used by both a panel and a run live in a **constants-only** module (for example `image-formats.ts`, `images-to-pdf/sizes.ts`, `rect.ts`) so panels do not import engine code, and `run.ts` does not import React.
- Shared helpers: `pdf-common.ts` (`loadPdf`, `pdfFile`, `selectPages`, `rgb`, `spotCentre`, `clampInt`), `image-common.ts` (`decodeFile`, `encodeFile`), `fields.tsx` (`inputClass`, `RangeField`, `SpotPicker`, `FormatFields`), `CropSurface.tsx` + `rect.ts` (drag-to-select).
- Option shapes are plain serialisable objects. Percentages and selections are stored as fractions so they do not depend on pixel sizes.
- Tools that use `preview: 'none'` (Crop image, Crop PDF) show their own interactive surface as the preview and get the wide options layout.

Current tools: merge-pdf, split-pdf, images-to-pdf, watermark, page-numbers, crop-pdf, metadata, extract-images, compress-pdf, protect-pdf, unlock-pdf, sign-pdf, resize-image, convert-image, rotate-image, crop-image, merge-images, compress-image, animated-gif, image-metadata.

To add a tool: manifest, run, panel, three registry entries, tests, and a README line for its known limits. Reuse the helpers above.

## PDF engine notes (`pdf-core`)

- `PdfDocument.load(bytes, { password? })` parses everything up front (objects, xref streams, object streams, rebuild-by-scanning fallback). Encrypted files are decrypted at load (RC4 40/128, AES-128/256, user or owner password, empty password tried first). `doc.pages()`, `doc.pageSize(page)`, `doc.pageBox(page)` (box plus rotation), `doc.resolve()`.
- Writing goes through `PdfBuilder` (classic xref). `compose(parts, { info })` builds a new PDF from page selections and is the base of merge, split, rotate, stamp, crop and metadata. It deep-copies reachable objects and renumbers them. A `Part` can have `prepare` (runs **before** the page dictionary is copied; use it to prune what must not be copied) and `edit` (runs after, with builder objects).
- **Edits rewrite the file**: bookmarks, form fields, named destinations and XMP are not carried over yet (M7). Page content, fonts, images and the document information are kept.
- `edit.ts`: `stamp` (draw on pages in *displayed* coordinates, rotation handled), `crop` / `cropBoxes` (displayed margins; `rewrite` makes it delete instead of hide), `setMetadata`. `images.ts`: `imagesToPdf`, `jpegInfo`. `text.ts`: Helvetica metrics and WinAnsi encoding for stamps. `info.ts`: /Info reading and writing. `content.ts`: `scanContent` (operators with byte ranges) and `usedResources`.
- `optimize(doc, { replace?, objectStreams? })` (`optimize.ts`) rewrites the *whole* document (unlike `compose`, it keeps bookmarks, forms and so on): reachable objects only, streams recompressed, identical streams/fonts/colour spaces merged (only types whose identity doesn't matter; never pages, annotations or optional-content groups), objects packed into object streams by `serializeCompact` in `writer.ts`. Pictures are swapped in through `replace` (old stream object to new one); the picture logic itself lives in `tools/src/compress-pdf/images.ts` and uses `imagePlacements` from pdf-render for the displayed size.
- Coordinates: stamps and crops are specified in the page **as displayed** (origin bottom-left, y up, `/Rotate` and crop box applied) and converted to user space inside the engine. Keep it that way and test rotated pages.
- `encryptPdf(doc, { userPassword, ownerPassword?, method?, permissions? })` (`encrypt.ts`) writes AES-256 (R6) or AES-128 (R4) protection; it reuses the password hashing in `security.ts`. Verify any change against an independent reader (pypdf in a throwaway venv: `python3 -m venv /tmp/venv && /tmp/venv/bin/pip install pypdf cryptography`).
- `stamp` can draw pictures: an `Overlay` may carry `images` made by `prepareImage` (compressed once, stored once per file however many pages use it).
- Errors the user can act on extend `UserError` (`PdfParseError`, `PdfPasswordError`, `PdfRangeError`, `PdfEncryptedError`).

## Renderer notes (`pdf-render`)

- `renderPage(doc, index, ctx, widthPx, { platform, signal })` draws onto any 2D context (OffscreenCanvas in the preview worker). `Interpreter` runs content streams; it also has an `onOp` hook and an `analysis` mode (no image decoding) used by `bounds.ts` (`analyzePage`, `removeOutside`) with a recording context (`BoundsCtx`).
- Fonts are drawn with **similar system fonts** at the exact PDF positions and widths (embedded outlines are stage R3, not done). The UI shows "Preview is approximate" when fonts are substituted.
- Not drawn yet: tiling patterns, mesh shadings, soft masks in graphics state, JPEG 2000 / JBIG2 / CCITT images (grey box plus a warning), vertical writing, text clip modes. These are documented in the README.
- **Always look at rendered output, not just call logs.** Fake-canvas unit tests missed a y-flip bug and a stale canvas-font bug that only real pixels showed.

## Platform seams

- Image codec: `codec()` / `setCodec()` in `image-core`. The app's worker sets `appCodec` (`image-core/browser`): our own decoders and encoders for PNG, JPEG, GIF and BMP, and the browser (OffscreenCanvas) only for WebP and for files ours refuse with `UnsupportedImage`. Tests call `setCodec(ownCodec)`; WebP can't be tested in Node. Decoders and encoders are pure and synchronous (`decodeJpeg`, `encodeJpeg`, `decodeGif`, `encodeGif`, `decodeBmp`, `encodeBmp`, `decodePng`, `encodePng`) and are used directly by tools that need more than one picture out (GIF frames, JPEG metadata segments).
- Flate: `deflate` / `inflate` in `core` use `CompressionStream` (async).
- Renderer `Platform`: `imageFromRGBA` and `decodeJpeg`. Tests pass fakes.

## Web app (`apps/web`)

- `ToolPage.tsx`: files | preview | options at `xl`; at `lg` the options stay on the right with the files above the preview; stacked below that, options before the preview. Options are always the right-hand region. Tools with their own surface (crop, sign) set `placesActions` and render the `actions` prop (run button, progress, errors) beside their controls. A finished run opens a modal `<dialog>` (download, keep editing, start over, use in another tool), not a card under the options. Locked PDFs open a password dialog and are replaced by a decrypted in-memory copy; the password is never stored.
- `previewController.ts` (pure, fake-timer tested) runs the same engine as the Run button: **600 ms debounce**, cancels stale runs, keeps the last result on screen. `ready` states have `stale` (outdated; Run never reuses a stale result) and `computing` (dim and "Updating..."). Do not make the UI react per keystroke.
- `previewWorker.ts` / `previewClient.ts`: one worker for inspect, render, unlock and metadata. The main thread never parses a PDF. Page canvases keep the old picture until the new one is ready (no flashing).
- Tool runs go through `runtime.ts` and `worker.ts` (progress, cancel, ZIP for several outputs). Limits: 50 files, 200 MB per file, 500 MB total.
- Home (`Home.tsx`) is drop-first: dropped files are handed to a tool through `handoff.ts`, the same mechanism as "Use in another tool".

## Design system

- **Palette**: `packages/ui/src/theme.css` holds the five scales (jet-black neutrals, cerulean accent, tropical-teal, muted-teal, tea-green) plus Tailwind red and amber for danger and warning. Components use **semantic tokens only** (`bg-surface`, `bg-surface-2`, `text-ink`, `text-muted`, `bg-accent`, `text-accent-ink`, `border-line`, `border-field` for input borders, `text-danger`, `bg-danger-soft`, `text-warning`, `bg-cat-pdf-soft`...), never raw scale colours or hex. Light and dark come from `light-dark()`; `data-theme` overrides the system setting.
- Contrast is enforced: text 4.5:1, icons and input borders 3:1. `node scripts/contrast.ts` must pass.
- Font is Inter, bundled through `@fontsource-variable/inter` (works offline; never load fonts from a CDN).
- Interaction rules: visible focus rings on everything (`focus-visible:outline-2 focus-visible:outline-accent`), `cursor: pointer` is set globally for enabled buttons, 44 px touch targets on coarse pointers (`pointer-coarse:`), transitions respect `prefers-reduced-motion`, no emoji as icons (icons are inline SVG in `Icon.tsx`), no horizontal page scroll at 375 px.
- `fieldset` has `min-width: 0` globally; keep label rows `flex flex-wrap` so selects cannot overflow the inspector (18 rem wide).
- Logo: the "split sheet" mark (`Logo.tsx`, `apps/web/public/favicon.svg`, `apps/desktop/build/icon.*`).
- Copy: sentence case, plain words, say what happened and what to do, no "please", no exclamation marks, no raw exception text.

## Testing

- Vitest, no DOM environment: engines and tools are tested in plain Node. Tool tests call `run()` directly with `FileData`.
- Fixtures: `packages/pdf-core/test/fixtures/` (`chromium.pdf`, `cups.pdf`, encrypted files made by pypdf with user password `user123` and owner password `owner456`). `packages/pdf-core/test/helpers.ts` has `assemble` and friends for hand-built PDFs; `packages/pdf-render/test/helpers.ts` has `onePage`, `fakeCtx`, `fakePlatform`.
- Add tests with every change: engine logic, error messages, and rotated pages for anything that places things on a page. Prefer a test that fails if the logic breaks over many shallow ones.
- Independent verification matters because our parser, writer and renderer could agree on the same mistake. There is no qpdf, mutool or Ghostscript here. Use Chromium's PDF viewer (see below) and pypdf-made fixtures as oracles. macOS `sips` mishandles `/Rotate`, `/CropBox` and annotation appearances, so never trust it for those.
- Codecs are checked the same way: Chromium decodes the files (`createImageBitmap` for JPEG/PNG/BMP, `ImageDecoder` for every GIF frame; both need a `file://` page, `data:` pages are not a secure context) and the result is compared with ours; our encoders' files must decode in Chromium. macOS `sips` makes baseline JPEG, GIF and BMP test files (and CMYK ones with `-m` and a CMYK profile). There are real progressive JPEGs and GIFs on most machines (`mdfind`). Keep personal files out of fixtures and out of what you print; use them only as local oracles.

## Verifying in the real app

- The in-app browser pane cannot open local files. Drive the **built Electron app**: `yarn build`, then `node_modules/.bin/electron apps/desktop/main.cjs --remote-debugging-port=9333` and script it over the Chrome DevTools Protocol (`Runtime.evaluate`, `Input.dispatchMouseEvent`, `Page.captureScreenshot`, `Emulation.setDeviceMetricsOverride` and `setEmulatedMedia` for dark mode and phone widths). Use a real file input drop by dispatching a `DragEvent` with a `DataTransfer`. Look at the screenshots.
- To view a PDF the way a real viewer does, load `file://...pdf` in an Electron `BrowserWindow` with `webPreferences.plugins: true`, wait a couple of seconds, `capturePage()`. The first window is often blank, so open a throwaway one first. Add `app.on('window-all-closed', () => {})` or the script quits after the first window.
- Keep throwaway scripts and screenshots in the session scratchpad, not in the repo. If you must put a temporary script in `scripts/` to resolve workspace imports, delete it afterwards.
- Stop any Electron instance you started (`pkill -f remote-debugging-port=9333`).

## Style

- Match the surrounding code: comment density, naming and idiom. Comments explain *why* (limits, gotchas, reasons), not what.
- Mark deliberate shortcuts that have a known ceiling with a `ponytail:` comment naming the ceiling and the upgrade path.
- Small files, one folder per tool, no abstractions without a second user, no config for values that never change.
- Prefer the platform (CSS, native elements) over code, and the standard library over dependencies. Do not add runtime dependencies to engine packages. UI-only asset packages (fonts) are fine.
- Never ship silent data loss: a tool that drops something (bookmarks, hidden layers) must say so in its panel or in the README limits.
- Do not put personal data in URLs, logs or tests.

## Workflow expectations

- For a feature, read the surrounding tool folders first and reuse the helpers above. For a bug, find the root cause (grep every caller) and fix it once where all callers route through.
- Big or ambiguous changes: plan first, name the files, and ask about decisions that change behaviour (the user likes to see design options before committing to one).
- Update `README.md` (roadmap row, known limits) when behaviour or limits change, and keep this file current when conventions change.
- After a change: typecheck, tests, build, then verify visually in the app for anything with UI. Report what was verified and what was not (Safari, Firefox and touch input have not been tested; only Electron's Chromium has).
- Leave changes uncommitted unless asked; offer a concise commit message.
