# Roadmap

Milestones, newest last. What each one left out is in [limits.md](limits.md).

| # | Milestone | Contents |
|---|---|---|
| M0 ✅ | Skeleton | Monorepo, UI shell, registry, Electron (removed in M8: Ream is a web app) |
| M1 ✅ | PDF core | Parser, writer; merge, split, rotate, remove/extract pages |
| M1.5 ✅ | Tool runtime | `run()` contract, Web Worker execution, progress/cancel, result card (download, ZIP, use in another tool), readable errors, size limits. Merge PDF is the first end-to-end tool |
| M2 ✅ | Image core | Pixel buffer, browser codec seam; resize, crop, rotate/flip, convert, stitch |
| M2.5 ✅ | Previews | File thumbnails, live result preview, password-protected PDFs (open with a password), own canvas PDF renderer (graphics, then text) |
| M2.6 ✅ | Look and feel | Teal palette (jet-black, cerulean, tropical-teal, muted-teal, tea-green), Inter font, split-sheet logo, drop-first home, three-region tool page (files, preview, options) |
| M3 ✅ | PDF edit | Images → PDF, watermark, page numbers, crop, metadata, extract images |
| M4 ✅ | Own codecs | Own PNG/GIF/BMP/JPEG codecs (WebP stays with the browser); compress image, compress PDF (structure and pictures), animated GIF, photo metadata (EXIF) |
| M5 ✅ | PDF security | Protect PDF (AES-256 or AES-128, user and owner passwords, permissions), Unlock PDF, Sign PDF (visual signature) |
| M6 ✅ | Image edit | Watermark image, blur or hide parts, filters, meme maker |
| M7 ✅ | PDF advanced | Organize pages, Repair, Flatten (now Lock the answers in Fill PDF form), PDF → text/Markdown, Bookmarks, TrueType embedding (watermark in any script) |
| M7b ✅ | Conversions | PDF → image, Word, Excel, PowerPoint; Excel → PDF; PowerPoint → PDF; previews of Office files (Word → PDF is not done) |
| M7.5 ✅ | PDF redaction and forms | Redact PDF (removed for good, not covered), Fill PDF form |
| M7.6 | Edit PDF | Add on top: text, pictures, shapes, drawings, whiteout, highlights, notes and links. Form fields: add, change, move and delete text fields, checkboxes, radio groups, dropdowns, lists, dates and signature boxes, set the Tab order, find fields on flat forms. Edit content: change, move and delete the page's own lines of text (in the PDF's font when it has the letters), move, resize, replace and delete its pictures, erase areas |
| M7.7 ✅ | Redesign | Industry design system (paper ground, one steel accent, square hairline frames with corner registration marks, Barlow Condensed over Barlow, Lucide icons at 1.5), tools home per category (`#/tools/pdf`, `#/tools/image`) with a drop bar, a clickable breadcrumb under the top bar on the tools home and tool pages, landing page |
| M8 ✅ | Ship | Web app on Cloudflare Pages (ream.deityhub.com), installable offline PWA, Electron app removed, MIT licence and third-party notices, pipeline (checks and previews on pull requests, production on merge into `main`), release versions with tags and rollback, Docker image (GHCR and Docker Hub) |
| Gate | Phase 2 | Decide per feature: OCR, Word and HTML → PDF, PDF/A, ML image tools |

Cross-cutting: grow the PDF test corpus (`packages/pdf-core/test/fixtures`), check accessibility on every new page.

