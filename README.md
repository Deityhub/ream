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
| `packages/office-core` | Zip-based Office files: XML reader, `.xlsx` read and write, `.docx` write, `.pptx` read and write, number formats |
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
| M5 ✅ | PDF security | Protect PDF (AES-256 or AES-128, user and owner passwords, permissions), Unlock PDF, Sign PDF (visual signature) |
| M6 ✅ | Image edit | Watermark image, blur or hide parts, filters, meme maker |
| M7 ✅ | PDF advanced | Organize pages, Repair, Flatten, PDF → text/Markdown, Bookmarks, TrueType embedding (watermark in any script) |
| M7b ✅ | Conversions | PDF → image, Word, Excel, PowerPoint; Excel → PDF; PowerPoint → PDF (Word → PDF is not done) |
| M8 | Ship | PWA, packaging, signing, auto-update, CI on 3 OSes |
| Gate | Phase 2 | Decide per feature: OCR, Word and HTML → PDF, PDF/A, ML image tools |

Cross-cutting: grow the PDF test corpus (`packages/pdf-core/test/fixtures`), check accessibility on every new page.

## Known M1 limits

- Merge and page operations dropped bookmarks, form fields and named destinations; since M7 they keep them (see "Known M7 limits").
- Encrypted PDFs need their password to be opened (see "Password-protected PDFs").
- Electron save dialog: the Download button relies on Chromium's default download prompt; not yet checked by hand.
- Streams other than Flate are copied through untouched but can't be decoded yet (only needed for xref/object streams).
- All objects are parsed up front; make parsing lazy if very large files become a problem.

## Known M2 limits

- WebP goes through the browser's codec (OffscreenCanvas in the worker); everything else is ours since M4. Tools that keep the input's format save an animated GIF as a flat PNG (first frame); Compress image and Animated GIF are the ones that work with all frames.
- HEIC, TIFF, RAW and SVG inputs are not accepted yet.
- Crop is drag-to-select with mouse or touch, plus numeric fields for keyboard use.
- Checked in Electron (Chromium) only; Safari and Firefox are untested.

## Known M3 limits

- **Edits rewrite the file.** Watermark, page numbers, crop and metadata rebuild the PDF from its pages. Since M7 bookmarks and form fields are carried over; tagged structure, layers (optional content), page labels and XMP metadata are not. Page content, fonts, images and the document information are kept.
- **Text stamps use Helvetica** (regular, bold, italic) with Latin letters, digits and common symbols. Other scripts need an uploaded TrueType font (see M7): without one they give a readable error. Text is one line; there is no image watermark yet. "Repeat over the page" tiles the text in a brick pattern at the chosen angle and spacing (at most 2000 copies a page).
- **A stamp behind the page** is hidden wherever the page paints an opaque background.
- **Crop PDF** is a drag-on-the-page cropper (the same component as Crop image) with "All pages" (the same proportions of every page, even when page sizes differ) or "This page only" (each page keeps its own selection). It works in displayed coordinates, so rotated pages crop the edges you see. **Delete** (the default) rewrites each cropped page's drawing instructions: text, shapes, pictures, inline images and links lying entirely outside the kept area are removed, together with the fonts and images only they used, and the page box becomes the kept area. Anything that touches the kept area stays whole in the file but is cut off at the new edge (a picture half inside keeps its hidden half; cropping the pixels inside a picture is not done yet). Invisible text, shading fills, text clipping and anything whose position can't be worked out are kept. A removed string leaves a same-length move behind only when other text on the line depends on it. **Just hide** only sets the page box and removes nothing. Verified by rendering hide and delete outputs of the same crop in Chromium's PDF viewer: zero differing pixels.
- **Images to PDF:** page sizes are the image's own, A3 to A6, B4, B5, US Letter, Legal, Tabloid, Executive, or a custom size in millimetres (20 to 5080); the margin is a slider in millimetres, up to half the page's short side less 10 mm. A JPEG goes in untouched. One stored sideways (EXIF) is decoded and saved again at quality 92 so it comes out upright. PNG, WebP, GIF and BMP go in as Flate-compressed pixels with their transparency, which is larger than a JPEG would be. A page is at most 200 inches.
- **Extract images:** JPEGs come out byte for byte; other pictures are saved as PNG. JPEG 2000, JBIG2 and CCITT pictures (typically scans) are skipped, the same gap as in the preview renderer. A picture used on several pages is saved once.
- Verified against Chromium's PDF viewer for rotated pages (stamp position, crop edges, page numbers), since our own renderer and the writer could otherwise agree on the same mistake.

## Known M7 limits

- **Bookmarks** (the outline) follow their pages through merge, split, extract, remove, rotate, reorder and the stamp, crop and metadata tools: entries whose page is gone are dropped (a parent whose children survive stays as a heading), several inputs list their bookmarks one after another, a page used twice is the target of its first copy. Links and bookmarks that named their destination now carry the destination itself. The **Bookmarks** tool edits the tree (rename, add, delete, move, indent, outdent, change the page); it rewrites only the outline and keeps the rest of the file. Page labels, tagged structure and layers are still dropped by the page tools.
- **Form fields** survive the page tools too: a field stays when a widget of it is on a kept page, and a merged file has the fields of every input with their shared defaults (two files that use one field name end up sharing its value, as PDF always does). Pages copied twice share their form widgets.
- **Organize pages:** a thumbnail grid with drag to move (and buttons for the same), turn, copy and delete. Thumbnails are drawn lazily by our own renderer. Dragging needs a mouse; touch screens use the move buttons.
- **Repair PDF** rebuilds a wrong or missing cross-reference table by scanning the file, puts back a lost catalog or page tree (pages are found by scanning for page objects), and saves a clean copy with correct lengths and no unreachable objects. A page whose content was cut off may come out blank. It cannot recover encrypted files without the password or data that is simply missing. Checked on truncated files, files with no catalog, wrong `startxref` and wrong stream lengths.
- **Flatten PDF** draws the appearance of form fields and of markup annotations (notes, highlights, stamps, drawings) into the page and removes them; links and other kinds stay. A text field without a picture is drawn from its value. The placement matrix is shared with the renderer (`appearanceMatrix`). Digital signatures stop validating.
- **PDF to text:** plain text or Markdown from where the text sits on the page: lines, words (from gaps and TJ spacing), columns (wide empty strips), paragraphs (line spacing), hyphenated words rejoined, ligatures spelled out, text turned to the page's reading direction. Markdown adds headings (type size against the body size), bullet lists, bold and italic. Text in render mode 3 (the invisible layer of scanned pages) is included. It does no OCR: a page that is a picture gives no text and says so. Tables come out as lines, CID fonts without a ToUnicode map and Type 3 fonts give nothing, and reading order is a heuristic. Checked against pypdf's extraction on the fixtures and on real documents: word recall and precision above 0.99 on all but a few pages whose only difference is words split or joined differently.
- **TrueType fonts in stamps:** the watermark can draw with an uploaded .ttf (the first font of a .ttc works too): the glyphs of the text are cut out, embedded as a Type0/CIDFontType2 font with a ToUnicode map, so the text is selectable and searchable. Glyphs are placed one after another with the font's advance widths: no kerning, ligatures or shaping, so Arabic and Indic scripts do not work. Fonts with PostScript outlines (.otf), web fonts and fonts whose licence flag forbids embedding are refused. Checked in Chromium's PDF viewer and with pypdf's text extraction (Cyrillic, Greek, Vietnamese with composite glyphs). Page numbers still use Helvetica. Our own preview draws such text with a similar system font.

## Known M7b limits

Office files (`.docx`, `.xlsx`, `.pptx`) are zips of XML; Ream reads and writes them itself (`packages/office-core`). The output has been opened by independent readers (python-docx, python-pptx, openpyxl) and by macOS Quick Look and Chromium's PDF viewer, but **not by Microsoft Office**. Everything runs on the device like the other tools.

- **PDF to image:** PNG or JPG, 72 to 300 dpi, any pages, a ZIP when there are several. Pages are drawn by our own renderer (see the renderer limits: fonts that are not stored in the file are drawn in similar ones).
- **PDF to Word:** *Editable text* rebuilds each page as paragraphs (lines joined, hyphenated words rejoined), headings from type size, bullets, alignment, indents, line and paragraph spacing, runs with the font name, size, bold, italic and colour, tables and pictures; every PDF page is a section of its own size. The layout is close, not exact: Word sets type with its own fonts, so lines can break differently and a full page can spill onto the next. Columns become one column (their text reads one after the other), drawings and shapes are left out, text boxes become paragraphs, ordered lists keep their numbers as text, and scans stay pictures. *Page pictures* puts each page in as a picture: identical, not editable, no text.
- **PDF to PowerPoint:** slides take the first page's size. *Editable text* gives text boxes where paragraphs were (type size, line height, colour, bold, italic, alignment), tables and pictures; drawings and backgrounds are left out. *Page pictures* puts a picture of the page on each slide with the page's text behind it (searchable, and there if the picture is deleted). Table text sizes follow the PDF; readers that ignore cell margins may wrap table text.
- **PDF to Excel:** finds tables drawn with ruled lines (merged cells where a line is missing, rows from the lines or, with only top and bottom lines, from the text) and tables made of text that lines up in at least three rows. Text outside tables is not saved. Amounts, plain numbers and percentages become numbers with the same display format; dates, codes with a leading zero, phone numbers and European-style 1.234,56 stay text. Irregular tables, tables split over pages (each part is its own table) and scans are not found. Two columns of running text are told apart from a table by their long cells, which is a guess.
- **Excel to PDF:** values as Excel displays them (number, percent, currency, date and time formats), column widths and row heights, wrapped text, text running into empty neighbours, merged cells, fills, borders, bold, italic, size and colour, hidden rows, columns and sheets left out. Fit to page width or real size across pages. Fonts become Helvetica, Times or Courier by name, with Calibri-like faces narrowed to match their widths, and letters those fonts lack show as ?; a .ttf (used for every cell) covers other scripts. Not drawn: charts, pictures, conditional formatting, data bars, comments and headers or footers; formulas show their stored value (a file never opened in Excel may have none); colour codes in number formats such as `[Red]` are ignored; repeating header rows and print areas are not applied.
- **PowerPoint to PDF:** one page per slide at the slide's size. Placeholders take position and text style from their layout and master; colours come from the theme (with tints and shades), text is laid out again with bullets and levels, alignment, line and paragraph spacing, shrink-to-fit scale and anchor. Shapes (a dozen presets; other shapes are drawn as their box), lines, pictures (PNG, JPEG, GIF, BMP; crops and rotation), tables (the default and Table Grid styles, banding, merged cells, borders) and backgrounds (colour or picture; a gradient shows its first colour) are drawn. Charts and diagrams are marked "not shown" where they were; EMF, WMF and SVG pictures show a grey box; animations, transitions, notes, vertical text, text effects, custom shapes and embedded objects are not reproduced. Text uses the standard fonts as in Excel to PDF, so lines can break differently from PowerPoint. Hidden slides are left out unless asked for.
- **Word to PDF is not done:** it needs a full layout engine (line breaking across pages, tables that split, floating objects, styles, fields).
- Password-protected Office files and the old `.doc`, `.xls` and `.ppt` formats are refused with a message that says what to do.
- Zip input is bounded (entry count, size, expansion) because Office files are untrusted input.

## Known M6 limits

- **Text is drawn by the browser.** Watermark text and meme captions are made into a transparent picture in the panel (with Inter and the bundled Anton font) and the engine only places that picture, so the engine has no font code and the tool's `run` can't make text by itself (tests pass a ready-made picture). Anything that can't be typed in those fonts falls back to the system font.
- **Watermark image:** text or a logo, one mark in one of nine spots or repeated over the picture (rows offset by half a step), any angle from -90 to 90 (the mark is turned before it is placed), size as a share of each picture's width, opacity. Every picture gets the same mark.
- **Blur or hide parts:** any number of rectangles, all treated the same way (pixelate, blur or a solid box). Strength is relative to each rectangle. The saved file is encoded afresh, so a covered area's pixels and any camera data are gone. A light blur can sometimes be partly undone by sharpening; the panel says so and recommends pixelate or cover for anything sensitive. Rectangles only: no freehand or oval areas, and no automatic face detection.
- **Filters:** brightness, contrast, colour, warmth, sepia, vignette, blur and sharpen, with a few one-click looks. Adjustments work on the stored (sRGB) values like a browser's CSS filters, not in linear light, and there are no colour curves or LUTs.
- **Meme maker:** capitals in Anton with a black outline, top and bottom, one size and colour for both, wrapped and shrunk to fit. Captions are made as wide as the picture (up to 4096 px, larger pictures get slightly softer letters).
- The saved file keeps the input's format (a GIF or BMP becomes PNG); an animated GIF is flattened to its first frame, as in the other image tools.

## Known M5 limits

- **Protect PDF** writes the standard security handler: AES-256 (revision 6, the default) or AES-128 (revision 4, "compatibility mode"). Everything is encrypted when the file is written, with fresh random keys and salts; bookmarks, forms, links and information are kept. Passwords may contain any characters. The permission limits (print, copy, edit) are a request that well-behaved readers respect, not a lock; with a restriction set and no owner password a random one is made up that nobody knows. RC4 is not offered. Checked with pypdf 6 and `cryptography` (an independent reader): a wrong password is refused, the right one opens the file, text extracts, the permissions read back as set, and the owner password works. Two small files made this way are fixtures (`enc-ream-aes*.pdf`, user password `pässword1`, owner `own-pw`).
- **Unlock PDF** saves a copy with no password and no limits. A locked file is opened with its password when it is added (the password is used once and not kept), so the tool receives the plain copy; a file with only an owner password opens without asking. Owner restrictions are not enforced on the working copy, as before. Signatures stop validating once a file is rewritten.
- **Sign PDF** puts a picture of a signature (drawn, typed in one of three bundled handwriting fonts, or uploaded with the paper made see-through) in a box you place on the last page, one page or every page, in the same place. It works on displayed coordinates, so rotated pages are right (checked in Chromium's viewer). It is a *visual* signature, like signing a printout: there is no certificate, nothing proves who signed, and later changes are not detected. Certificate-based digital signatures are not done.

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
- Adding a locked file shows a password popup; on success the file is replaced in the list by a decrypted in-memory copy. The original file is untouched and the password is never stored. Output PDFs are not encrypted unless made with Protect PDF.
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
