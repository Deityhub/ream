// The release version: the root package.json's "version", tagged v<version> when it reaches main.
//   node scripts/release.ts check     fail unless the version is new and higher than every released one (PRs into main)
//   node scripts/release.ts version   print it (the release job's tag and deploy message)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const version: string = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).version
const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number)
const newer = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const mode = process.argv[2]
const own = parse(version)
if (!own) {
  console.error(`package.json version "${version}" isn't major.minor.patch (like 1.2.0)`)
  process.exit(1)
}
if (mode === 'version') console.log(version)
else if (mode === 'check') {
  // tags need the full history: actions/checkout with fetch-depth 0
  const released = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').map((t) => parse(t.trim().slice(1))).filter((v): v is number[] => !!v)
  const latest = released.sort(newer).at(-1)
  if (latest && newer(own, latest) <= 0) {
    console.error(`Version ${version} is already released or older than the latest release (${latest.join('.')}). Raise it in this pull request: yarn version patch, minor or major.`)
    process.exit(1)
  }
  console.log(`Version ${version} will be released${latest ? ` (latest is ${latest.join('.')})` : ' (the first release)'}.`)
} else {
  console.error('usage: node scripts/release.ts check | version')
  process.exit(1)
}
