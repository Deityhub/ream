# Contributing to Ream

Thanks for helping. Ream is a set of PDF and image tools that run entirely in the browser: files are never uploaded. Keep that true in everything you change.

## Setting up

You need Node 22 (22.18 or later runs the `.ts` scripts directly) and Yarn 4, which Node's Corepack provides:

```bash
corepack enable
yarn install
yarn dev          # http://localhost:5173
```

Use Yarn, not npm or pnpm.

## Before you open a pull request

```bash
yarn typecheck
yarn test
yarn build
node scripts/notices.ts --check     # after changing dependencies, run it without --check and commit the result
```

These are what the `check` job runs (plus building and testing the Docker image). Also run `node scripts/contrast.ts` after changing `packages/ui/src/theme.css`, and `node scripts/render-compare.ts` (macOS) after changing the PDF renderer.

Add tests with your change: engines and tools are tested in plain Node, and a tool's tests call its `run()` directly. For anything with a screen, look at it in a browser at desktop and phone widths, in light and dark.

## Branches and releases

- Branch from `dev` and open your pull request into `dev`. It runs `check` and gets a preview deploy, linked in a comment.
- A release is a pull request from `dev` into `main` that raises the version with `yarn version patch|minor|major`. Merging it deploys ream.deityhub.com, tags the version and publishes the release notes and Docker image. See [docs/deploy.md](docs/deploy.md).

## Ground rules

- **Nothing leaves the device.** No network request may carry a user's file or anything about it. The only request Ream makes is Download free fonts (font names, on the user's click). A new host needs the content security policy in `apps/web/public/_headers` changed, and a good reason.
- **Own engines.** The PDF parser and writer, the renderer, the image codecs and the Office readers are Ream's own. The engine packages have no runtime dependencies; don't add pdf.js, pdf-lib, sharp and the like.
- **MIT-compatible only.** Ream is MIT licensed. Anything shipped must be too (MIT, ISC, BSD, Apache-2.0, OFL for fonts); no GPL, AGPL or LGPL. `node scripts/notices.ts` fails on anything else.
- **Honest limits.** When something is approximate or unsupported, say so in the tool's panel and in [docs/limits.md](docs/limits.md).
- **Copy:** British spelling, sentence case, plain words; say what happened and what to do.

[AGENTS.md](AGENTS.md) has the full guide to the code: the tool contract, the engines, the design system and how changes are checked. Read it before larger changes.

## Layout

| Path | What |
|---|---|
| `packages/core` | Tool types, errors, limits, zip, Flate |
| `packages/pdf-core` | PDF parser, writer and page operations |
| `packages/pdf-render` | The PDF renderer, text extraction and layout analysis |
| `packages/office-core` | `.xlsx`, `.docx` and `.pptx` reading and writing |
| `packages/image-core` | Pixel operations and the PNG, JPEG, GIF and BMP codecs |
| `packages/ui` | Theme tokens and shared React components |
| `packages/tools` | One folder per tool, plus the registry |
| `apps/web` | The web app (Vite, React, Tailwind) and its service worker |
| `scripts/` | Dev tooling: CLI, fixtures, renderer comparison, contrast and licence checks, headless Chrome |
| `docs/` | Roadmap, known limits, design, deploy and releases |

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
