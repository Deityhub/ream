// The release version (the root package.json's "version", tagged v<version> when it reaches main) and its CHANGELOG.md section.
//   node scripts/release.ts prepare patch|minor|major   raise the version and write its changelog section (yarn release ...)
//   node scripts/release.ts check     fail unless the version is new, higher than every released one, and in the changelog (PRs into main)
//   node scripts/release.ts version   print it (the release job's tag and deploy message)
//   node scripts/release.ts notes     print its changelog section (the GitHub Release's text)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const pkgPath = join(root, 'package.json')
const logPath = join(root, 'CHANGELOG.md')
const HEADER = '# Changelog\n\nWhat changed in each release of Ream. `yarn release patch|minor|major` writes a section from the pull requests merged since the last release; edit it in the release pull request.\n'

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number)
const newer = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const version: string = JSON.parse(readFileSync(pkgPath, 'utf8')).version
const own = parse(version) ?? fail(`package.json version "${version}" isn't major.minor.patch (like 1.2.0)`)
/** the newest released version: tags need the full history (actions/checkout with fetch-depth 0, or git fetch --tags) */
const latest = () =>
  git('tag', '--list', 'v*')
    .split('\n')
    .map((t) => parse(t.trim().slice(1)))
    .filter((v): v is number[] => !!v)
    .sort(newer)
    .at(-1)
const changelog = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '')
/** the text under "## <v>" up to the next section, or null when there is none */
const section = (v: string) => {
  const m = new RegExp(`^## ${v.replace(/\./g, '\\.')}\\b.*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(changelog())
  return m ? m[1].trim() : null
}

/** what reached dev since `from`: each pull request by its title and link, and commits made on dev directly */
function entries(from: string | null): string[] {
  const repo = git('remote', 'get-url', 'origin').trim().replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
  const range = from ? [`${from}..HEAD`] : ['HEAD']
  const out: string[] = []
  for (const c of git('log', '--first-parent', '--format=%s%x00%b%x01', ...range).split('\x01')) {
    const [subject, body = ''] = c.trim().split('\x00')
    if (!subject) continue
    const pr = /^Merge pull request #(\d+) from [^/]+\/(\S+)/.exec(subject)
    if (pr) {
      if (pr[2] === 'dev' || pr[2] === 'main') continue // an earlier release (dev into main)
      out.push(`- ${body.trim().split('\n')[0] || pr[2]} ([#${pr[1]}](${repo}/pull/${pr[1]}))`)
    } else if (!/^Merge /.test(subject) && !/^Release v\d/.test(subject)) out.push(`- ${subject}`)
  }
  return out
}

const mode = process.argv[2]
if (mode === 'version') console.log(version)
else if (mode === 'notes') console.log(section(version) ?? fail(`CHANGELOG.md has no section for ${version}.`))
else if (mode === 'check') {
  const last = latest()
  if (last && newer(own, last) <= 0) fail(`Version ${version} is already released or older than the latest release (${last.join('.')}). Raise it in this pull request: yarn release patch, minor or major.`)
  if (!section(version)) fail(`CHANGELOG.md has no section for ${version}, or it is empty. yarn release patch, minor or major writes one.`)
  console.log(`Version ${version} will be released${last ? ` (latest is ${last.join('.')})` : ' (the first release)'}.`)
} else if (mode === 'prepare') {
  const kind = process.argv[3]
  if (kind !== 'patch' && kind !== 'minor' && kind !== 'major') fail('usage: yarn release patch | minor | major')
  // counted from the latest release, so preparing twice doesn't skip a version
  const last = latest()
  const [ma, mi, pa] = last ?? own
  const next = kind === 'major' ? `${ma + 1}.0.0` : kind === 'minor' ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`
  if (section(next) !== null) fail(`CHANGELOG.md already has a section for ${next}.`)
  const list = entries(last ? `v${last.join('.')}` : null)
  if (!list.length) fail(`Nothing reached this branch since v${last?.join('.')}: there is nothing to release.`)
  const date = new Date().toISOString().slice(0, 10)
  const old = changelog()
  const body = old.startsWith('# Changelog') ? old.slice(old.indexOf('\n## ') + 1 || old.length) : old
  writeFileSync(logPath, `${HEADER}\n## ${next} (${date})\n\n${list.join('\n')}\n${body ? `\n${body.trimStart()}` : ''}`)
  writeFileSync(pkgPath, readFileSync(pkgPath, 'utf8').replace(/("version":\s*)"[^"]*"/, `$1"${next}"`))
  console.log(`Version ${next}, with ${list.length} change${list.length === 1 ? '' : 's'} in CHANGELOG.md. Edit the section if you like, then commit "Release v${next}" and open the pull request.`)
} else fail('usage: node scripts/release.ts prepare patch|minor|major | check | version | notes')
