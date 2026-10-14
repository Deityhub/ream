# Ream

PDF and image tools that run entirely on your device, in the browser or as an Electron app. Own engines, no runtime dependencies in phase 1.

```bash
yarn dev          # web app on http://localhost:5173
yarn desktop      # build, then open in Electron
yarn test         # vitest
yarn typecheck
yarn pdf <cmd>    # dev CLI for pdf-core: info | merge | extract | remove | rotate | split | decrypt | optimize
```

## Layout

| Path | What |
|---|---|
| `packages/core` | Tool manifest types |
| `packages/pdf-core` | Own PDF parser, writer and page operations (pure TS, no DOM) |
| `packages/image-core` | RGBA pixel buffer, resize/crop/rotate/flip/stitch, own PNG, JPEG, GIF and BMP codecs, colour quantiser, EXIF, browser codec for WebP |
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
| M2.5 ✅ | Previews | File thumbnails, live result preview, password-protected PDFs (open with a password), own canvas PDF renderer (graphics, then text) |
| M2.6 ✅ | Look and feel | Teal palette (jet-black, cerulean, tropical-teal, muted-teal, tea-green), Inter font, split-sheet logo, drop-first home, three-region tool page (files, preview, options) |
| M3 ✅ | PDF edit | Images → PDF, watermark, page numbers, crop, metadata, extract images |
| M4 ✅ | Own codecs | Own PNG/GIF/BMP/JPEG codecs (WebP stays with the browser); compress image, compress PDF (structure and pictures), animated GIF, photo metadata (EXIF) |
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

- WebP goes through the browser's codec (OffscreenCanvas in the worker); everything else is ours since M4. Tools that keep the input's format save an animated GIF as a flat PNG (first frame); Compress image and Animated GIF are the ones that work with all frames.
- HEIC, TIFF, RAW and SVG inputs are not accepted yet.
- Crop is drag-to-select with mouse or touch, plus numeric fields for keyboard use.
- Checked in Electron (Chromium) only; Safari and Firefox are untested.

## Known M3 limits

- **Edits rewrite the file.** Watermark, page numbers, crop and metadata rebuild the PDF from its pages, so bookmarks, form fields, named destinations and XMP metadata are not carried over yet (M7). Page content, fonts, images and the document information are kept.
- **Text stamps use Helvetica** (regular, bold, italic) with Latin letters, digits and common symbols. Other scripts (Cyrillic, Greek, CJK) give a readable error until TrueType embedding arrives in M7. Text is one line; there is no image watermark yet. "Repeat over the page" tiles the text in a brick pattern at the chosen angle and spacing (at most 2000 copies a page).
- **A stamp behind the page** is hidden wherever the page paints an opaque background.
- **Crop PDF** is a drag-on-the-page cropper (the same component as Crop image) with "All pages" (the same proportions of every page, even when page sizes differ) or "This page only" (each page keeps its own selection). It works in displayed coordinates, so rotated pages crop the edges you see. **Delete** (the default) rewrites each cropped page's drawing instructions: text, shapes, pictures, inline images and links lying entirely outside the kept area are removed, together with the fonts and images only they used, and the page box becomes the kept area. Anything that touches the kept area stays whole in the file but is cut off at the new edge (a picture half inside keeps its hidden half; cropping the pixels inside a picture is not done yet). Invisible text, shading fills, text clipping and anything whose position can't be worked out are kept. A removed string leaves a same-length move behind only when other text on the line depends on it. **Just hide** only sets the page box and removes nothing. Verified by rendering hide and delete outputs of the same crop in Chromium's PDF viewer: zero differing pixels.
- **Images to PDF:** page sizes are the image's own, A3 to A6, B4, B5, US Letter, Legal, Tabloid, Executive, or a custom size in millimetres (20 to 5080); the margin is a slider in millimetres, up to half the page's short side less 10 mm. A JPEG goes in untouched. One stored sideways (EXIF) is decoded and saved again at quality 92 so it comes out upright. PNG, WebP, GIF and BMP go in as Flate-compressed pixels with their transparency, which is larger than a JPEG would be. A page is at most 200 inches.
- **Extract images:** JPEGs come out byte for byte; other pictures are saved as PNG. JPEG 2000, JBIG2 and CCITT pictures (typically scans) are skipped, the same gap as in the preview renderer. A picture used on several pages is saved once.
- Verified against Chromium's PDF viewer for rotated pages (stamp position, crop edges, page numbers), since our own renderer and the writer could otherwise agree on the same mistake.

## Known M4 limits

- **Codecs.** JPEG: baseline, extended-sequential and progressive Huffman files, 8 bits, grey, YCbCr and Adobe CMYK/YCCK, any sampling, restart markers (a damaged stretch costs only its own interval); arithmetic-coded, lossless and 12-bit JPEGs are refused with a clear message (the browser is tried first when it is available). The encoder writes baseline JFIF, 4:4:4, 4:2:2 or 4:2:0, with Huffman tables built for the picture. PNG: all bit depths and colour types, Adam7; the encoder picks the smallest exact form (palette, grey, RGB) and the best filter per row, deflate is the platform's. GIF: every frame, disposal modes, interlace, transparency; the encoder gives each frame its own palette and stores only what changed when nothing is transparent. BMP: 1 to 32 bits, bitfields, RLE; no JPEG or PNG inside a BMP. WebP: browser only (not in Node, and only where the browser can write it).
- **Verification.** Our decoders were checked against Chromium's on 296 real JPEGs (every pixel within 3 levels), 69 real GIFs with all their frames (identical), and files made by other tools; our encoders' output was decoded by Chromium. `packages/image-core/test/fixtures/README.md` lists the fixtures.
- **Colour profiles** are not applied: pixels are taken as sRGB, so a wide-gamut (Display P3) photo converted to another format can look a little less saturated. Compress image keeps a JPEG's profile (and a PNG's colour chunks) so the result looks like the original. EXIF orientation is applied when decoding.
- **Compress image:** JPEG at a chosen quality (4:2:0 below 90), PNG kept pixel for pixel or reduced to fewer colours (median cut, optional dithering), GIF with all its frames re-encoded, BMP saved as PNG. A file that doesn't get smaller is returned unchanged. JPEG camera data and location are removed unless "keep" is ticked; the colour profile always stays.
- **Animated GIF:** pictures in the order of the list, one delay for all, loop forever or once, "back and forth", a width, and how pictures of other shapes are fitted. At most 300 pictures; each frame has up to 256 colours of its own.
- **Photo metadata:** reads EXIF (camera, lens, exposure, dates, GPS, text), XMP, IPTC and PNG text. "Remove everything" keeps the colour profile and the orientation (a sideways photo would otherwise turn) and drops data appended after a JPEG (motion photos); "Remove location only" rebuilds the EXIF without the GPS directory, thumbnail and maker notes and drops XMP that mentions GPS. Place names typed into IPTC captions are not touched. JPEG and PNG only. The picture data is never re-encoded.
- **Compress PDF** keeps the whole document (pages, text, links, bookmarks, forms, labels, information) and drops what is not reachable from the catalog, page thumbnails and editing-program private data (`/PieceInfo`). Streams are compressed again, identical streams, fonts and colour spaces are stored once, and plain objects go into PDF 1.5 object streams with a cross-reference stream. *Balanced* and *Smallest* also save pictures again: a JPEG, or a Flate picture with many shades (photograph, scan), becomes a JPEG at quality 72 or 50, and any picture shown sharper than 150 or 96 dpi loses pixels (the shown size comes from our renderer's own analysis of the pages). Line art and text pictures stay lossless and only lose pixels. Pictures with masks, a /Decode array, a colour-key mask, CMYK, indexed colours, JPEG 2000, JBIG2 or CCITT data are left as they are, and a picture's soft mask is kept at its own size. Pictures used only inside tiling patterns or Type 3 fonts are not resampled. Digital signatures no longer validate, and the output is not encrypted. Checked by rendering original and compressed pages in Chromium's PDF viewer: the lossless output matched pixel for pixel on 15 of 16 pages compared (the 16th differs only by the viewer's one-pixel scroll offset), and the picture levels were checked by eye on real scans and forms.

## Live preview timing

The result preview waits 600 ms after the last change to any option before it re-runs the tool (`DEBOUNCE_MS` in `apps/web/src/previewController.ts`). Until then the last result stays on screen at full strength, so nothing flickers while someone types or drags a slider; it dims only while the new one is computed. The previous pages stay drawn until their replacements are ready. The Run button never reuses an outdated result (`stale`), whatever the screen shows.

## Password-protected PDFs

- Opening works for the standard password handler: RC4 40/128-bit, AES-128 and AES-256 (revisions 2 to 6), with either the user or the owner password. Files that only restrict editing (empty user password) open without asking.
- Adding a locked file shows a password popup; on success the file is replaced in the list by a decrypted in-memory copy. The original file is untouched and the password is never stored. Output PDFs are not encrypted (encrypting and the Protect/Unlock tools are M5).
- Owner restrictions (no printing, no copying) are not enforced on the working copy.
- Certificate (public-key) encryption is not supported and reports "This PDF uses protection Ream can't open yet."
- `node scripts/pdf.ts decrypt in.pdf -p <password> -o out.pdf` does the same from the command line. The encrypted test fixtures come from `scripts/make-encrypted-fixtures.py` (pypdf, an independent implementation; not a project dependency).

## PDF previews (our own renderer)

`packages/pdf-render` draws PDF pages onto a canvas (OffscreenCanvas in the preview worker): paths, fills, strokes, dashes, clipping, colour spaces (gray, RGB, CMYK, ICC by component count, Lab, Indexed, Separation, DeviceN), PDF functions (types 0, 2, 3, 4), images (raw, Flate, LZW, JPEG, with soft masks, colour-key masks and stencil masks), inline images, Form XObjects, axial and radial shadings and shading patterns (honouring /Extend), transparency and blend modes, annotation appearances, and text.

**Text** is drawn glyph by glyph at the exact positions the PDF gives, advancing by the PDF's own widths, so lines break where the original breaks. Characters come from the font's encoding and `/Differences`, falling back to its ToUnicode CMap (this is what makes subset CID fonts from Word, Chrome and Quartz readable). The letter shapes come from a similar system font: the document's own font name is tried first, so an installed copy is used as is, then a serif, sans or monospace stack. Because the real glyph outlines aren't used yet, the preview carries a "Preview is approximate" note whenever fonts are substituted.

- Not drawn yet: embedded font shapes (stage R3: own TrueType, CFF and Type 1 outline readers), vertical writing, text used as a clipping path, CJK fonts that only have a predefined CMap, tiling patterns, mesh shadings, soft masks in graphics state, JPEG 2000 / JBIG2 / CCITT images (a grey box marks where they go).
- CMYK uses a polynomial fit to a print profile, so it is close to Acrobat and macOS but not identical.
- `node scripts/render-compare.ts` renders a corpus of feature PDFs (including a text sheet with the standard fonts and every text operator) and the real fixtures with our renderer and with macOS CoreGraphics (`sips`), writes side-by-side sheets with a difference image, and fails if the pixel mismatch grows past the recorded limits. `sips` mishandles `/Rotate`, `/CropBox` and annotation appearances, so those are checked against Chromium's PDF engine by eye instead.

## Design

- **Palette**: `packages/ui/src/theme.css` holds the five colour scales. Components only use the semantic tokens (`bg-surface`, `text-muted`, `bg-accent`, `border-field`, `text-danger`, ...), which switch between light and dark with `light-dark()`. jet-black is the neutral scale and cerulean the accent; muted-teal tints image tools and success. The palette has no red or amber, so danger and warning use Tailwind's red and amber stops.
- `node scripts/contrast.ts` checks every token pair (4.5:1 for text, 3:1 for icons and input borders) in both modes and fails if one drops below.
- **Font**: Inter, bundled through `@fontsource-variable/inter` so it works offline and nothing loads from a CDN.
- **Logo**: one sheet cut on a diagonal and slid apart (split and merge). `Logo` in `packages/ui` follows the theme; `apps/web/public/favicon.svg` and `apps/desktop/build/icon.{svg,png}` are the static versions. `.icns` and `.ico` packaging belongs to M8.
- Not done: page thumbnails strip in the tool page (waits for M3 tools whose output keeps one page per input page), sidebar and command palette (when the tool list outgrows the home grid).
