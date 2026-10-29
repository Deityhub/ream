# Deploy, offline app and releases

## Cloudflare Pages

The site is https://ream.deityhub.com, on Cloudflare Pages. `.github/workflows/web.yml` runs `check` (typecheck, tests, the notices check and the build) on pull requests into `dev` and `main` and on merges into `main`. A pull request into `dev` then deploys a preview (`<branch>.ream-bqb.pages.dev`, linked in a comment on the PR); a merge into `main` deploys the live site. Plain pushes run nothing. It needs two repo secrets, `CLOUDFLARE_API_TOKEN` (Account → Cloudflare Pages → Edit) and `CLOUDFLARE_ACCOUNT_ID`; without them the deploy step is skipped. A bad release is undone in the Cloudflare dashboard: Workers & Pages → ream → Deployments → an earlier one → Rollback.

`apps/web/public/_headers` sets the response headers: a content security policy that lets the page load only its own files (plus Fontsource and jsDelivr, for Download free fonts), no inline scripts or styles, no framing; no referrer; and a year's caching for the content-named files in `/assets`. To try the headers locally: `yarn build`, then `yarn dlx wrangler@4 pages dev apps/web/dist`.

## Installable and offline (PWA)

Ream is a progressive web app. `apps/web/public/manifest.webmanifest` and the icons in `apps/web/public/icons` (drawn from `apps/web/icons/icon.svg` by `node scripts/icons.ts`) make it installable: Chrome and Edge show Install Ream on the landing page, Safari has File → Add to Dock, iPhone and iPad have Share → Add to Home Screen. The service worker (`apps/web/sw.js`, written into the build as `sw.js` with its file list by the `serviceWorker` plugin in `vite.config.ts`) keeps the app on the device:

- On the first visit it downloads about 6 MB in the background: the app, its fonts, every tool, and the Office look-alike fonts for Latin scripts. After that every tool works with no connection.
- Office fonts for other scripts (Cyrillic, Greek, Hebrew, Vietnamese) are kept the first time a file needs them; a file that needs one offline before then falls back like a missing font.
- A new deploy is downloaded when the app is opened or comes back into view, and a bar offers to reload into it; it never switches by itself, so a tool isn't cut off half way. The page itself always comes from the network when there is one, so a plain reload is current.
- Limits: the first visit needs a connection; Firefox works offline but can't install sites as apps on the desktop; the browser can clear the saved app when the device is short of space (it is then downloaded again on the next visit). Checked in Chrome only.


## Addresses and search

Every page has a real address: `/`, `/tools/`, `/tools/pdf/`, `/tools/image/`, `/tool/<id>/` (and `/licence/`, `/notices/`). The build writes a file for each (`tool/merge-pdf/index.html`), with its own title, description, canonical address, social card tags and structured data in the head and plain text inside the page, so search engines and link previews don't depend on running the app. `404.html` is also built, and **must stay**: without it Cloudflare Pages treats the site as a single-page app and answers every unknown address with 200 (a "soft 404" that search engines distrust). `sitemap.xml` lists every page worth finding. `node scripts/seo-check.ts` checks all of it on the built site, and `check` runs it. The Docker image gets the same files, with NGINX answering unknown addresses with `404.html`.

Old links with a `#/` (`/#/tool/merge-pdf`) still work: the app turns them into the new addresses when the page opens.

After a release, once: add `ream.deityhub.com` in [Google Search Console](https://search.google.com/search-console) (a DNS TXT record in Cloudflare proves you own it), submit `https://ream.deityhub.com/sitemap.xml`, and do the same in [Bing Webmaster Tools](https://www.bing.com/webmasters), which also feeds DuckDuckGo and others. Pages usually appear in search within days to weeks; Search Console shows which are indexed and why one isn't. The social card is `apps/web/public/og.png` (`node scripts/og.ts` redraws it).

## Releases and versions

The release version is the root `package.json` `version` (semantic versioning: `major.minor.patch`).

1. Work reaches `dev` through pull requests; each gets a preview.
2. To release, run Actions → **Prepare release** → Run workflow and pick `patch`, `minor` or `major`. It does the step below on a copy of `dev` and opens the pull request "Release v<version>" into `dev`; edit the changelog there if needed and merge it. It needs the `RELEASE_TOKEN` secret to get `check` and a preview on that pull request (see below); without it the pull request opens with no checks. Or do it by hand: branch from `dev` (`release/v<version>`) and run `yarn release patch` (fixes), `minor` (new tools or features) or `major` (anything that breaks how people use Ream). It raises the version (counted from the latest tag: `git fetch --tags` first) and adds a section to `CHANGELOG.md` listing the pull requests merged since the last release, each with its link. Edit the section into plain words if you like, commit `Release v<version>`, and merge it into `dev` through a pull request.
3. Open the pull request from `dev` into `main`. `check` fails while the version is one already released or older, or `CHANGELOG.md` has no section for it (`node scripts/release.ts check`).
4. Merging it deploys production with the version in Cloudflare's deployment message, tags `v<version>`, creates a GitHub Release whose notes are the version's `CHANGELOG.md` section, and publishes the Docker image.

`RELEASE_TOKEN` is a fine-grained personal access token (GitHub → Settings → Developer settings → Fine-grained tokens): repository access only `Deityhub/ream`, permissions **Contents** and **Pull requests** read and write. Save it as a repository secret (Settings → Secrets and variables → Actions). It expires on the date you choose; make a new one when it does. GitHub doesn't run workflows for pull requests its own token opens, which is why the workflow uses yours. Like any manual workflow, **Prepare release** shows in the Actions tab only once it is on `main`.

The footer shows the version, so a bug report can say which one it was.

**Rolling back**

- Fastest: Cloudflare dashboard → Workers & Pages → ream → Deployments → the deployment of the version you want (its message is `v<version>`) → Rollback.
- From git: Actions → **Deploy a version** → Run workflow, with a released version such as `0.1.0`. It builds that tag again and deploys it to production. Use it when Cloudflare's history no longer has the deployment.

Either way, fix forward with a new version afterwards: a rollback doesn't change `main`.

## Docker

The `Dockerfile` builds the site and serves it with NGINX (as a non-root user, on port 8080). The NGINX site is generated from `apps/web/public/_headers` by `scripts/nginx-conf.ts`, so the image sends the same security policy and caching as ream.deityhub.com.

```bash
docker run --rm -p 8080:8080 ghcr.io/deityhub/ream   # or deityhub/ream on Docker Hub
docker build -t ream . && docker run --rm -p 8080:8080 ream   # from the source
```

Every release pushes `:<version>` and `:latest` for amd64 and arm64 to `ghcr.io/deityhub/ream` (with the workflow's own token) and to Docker Hub (`DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repo secrets; skipped without them). A new GHCR package starts private: make it public once under the package's settings. `check` builds and runs the image on every pull request and checks the page, the headers, a 404 and that NGINX isn't root.

To serve it under HTTPS (needed for installing the app and for the offline worker anywhere but `localhost`), put it behind your usual proxy (Caddy, Traefik, NGINX). Ream needs no environment variables, volumes or database.

## Branch rules

`.github/rulesets/protect-dev-main.json` requires a pull request and a passing `check` (with the branch up to date) for `dev` and `main`, and blocks force pushes and deleting them. GitHub only enforces rulesets on public repositories on the free plan: once the repository is public, import it under Settings → Rules → Rulesets → New ruleset → Import a ruleset.
