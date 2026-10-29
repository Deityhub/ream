# Changelog

What changed in each release of Ream. `yarn release patch|minor|major` writes a section from the pull requests merged since the last release; edit it in the release pull request.

## 0.3.0 (2026-10-29)

- SEO: real URLs, a page per route, copy for all 37 tools ([#12](https://github.com/Deityhub/ream/pull/12))
- robots.txt: block AI training crawlers; noindex the pages.dev addresses ([#11](https://github.com/Deityhub/ream/pull/11))
- README: build and test status badge ([#10](https://github.com/Deityhub/ream/pull/10))

## 0.2.0 (2026-10-27)

- Faster tool processing ([#7](https://github.com/Deityhub/ream/pull/7))
- A changelog for each release, written by `yarn release` or the Prepare release workflow, and used as the release notes

## 0.1.0 (2026-10-27)

- The first release: Ream as a web app at ream.deityhub.com that installs as a PWA and works offline, with 37 tools for PDFs, images and Office files that run on your device.
- Docker image on GitHub Container Registry and Docker Hub, MIT licence and third-party notices.
