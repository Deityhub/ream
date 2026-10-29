import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const root = new URL('../../../', import.meta.url)
const robots = readFileSync(new URL('apps/web/public/robots.txt', root), 'utf8')

/** the groups of a robots.txt: the agents that share the rules, and the rules */
function groups(text: string) {
  const out: { agents: string[]; rules: [string, string][] }[] = []
  let current: (typeof out)[number] | null = null
  let lastWasAgent = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    const at = line.indexOf(':')
    if (at < 0) continue
    const key = line.slice(0, at).trim().toLowerCase()
    const value = line.slice(at + 1).trim()
    if (key === 'sitemap') continue
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) out.push((current = { agents: [], rules: [] }))
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else if (current) {
      current.rules.push([key, value])
      lastWasAgent = false
    }
  }
  return out
}

/** whether the whole site is closed to this crawler: its own group if it has one, else the `*` group (RFC 9309) */
function blocked(agent: string) {
  const all = groups(robots)
  const own = all.find((g) => g.agents.includes(agent.toLowerCase())) ?? all.find((g) => g.agents.includes('*'))!
  return own.rules.some(([k, v]) => k === 'disallow' && v === '/')
}

describe('robots.txt', () => {
  test('search engines and link-preview bots are welcome', () => {
    for (const agent of ['Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot', 'Twitterbot', 'LinkedInBot', 'facebookexternalhit', 'Slackbot', 'WhatsApp']) {
      expect(blocked(agent), agent).toBe(false)
    }
  })

  test('AI training crawlers are blocked', () => {
    for (const agent of ['GPTBot', 'ClaudeBot', 'anthropic-ai', 'CCBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'Meta-ExternalAgent', 'cohere-ai', 'Diffbot', 'Amazonbot']) {
      expect(blocked(agent), agent).toBe(true)
    }
  })

  test('AI search and assistant fetchers are not blocked, as chosen', () => {
    for (const agent of ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User']) {
      expect(blocked(agent), agent).toBe(false)
    }
  })

  test('says AI training is off in the content signals, names the sitemap and lists nobody twice', () => {
    expect(robots).toMatch(/^Content-Signal: .*\bai-train=no\b/m)
    expect(robots).toMatch(/^Sitemap: https:\/\/ream\.deityhub\.com\/sitemap\.xml$/m)
    const agents = groups(robots).flatMap((g) => g.agents)
    expect(agents.length).toBe(new Set(agents).size)
  })
})

describe('search engines and the other addresses of the site', () => {
  // the rules, without their comments
  const headers = readFileSync(new URL('apps/web/public/_headers', root), 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n')

  test("Cloudflare's own addresses (and previews) are noindex, the custom domain is not", () => {
    for (const host of ['https://:project.pages.dev/*', 'https://:version.:project.pages.dev/*']) {
      expect(headers).toMatch(new RegExp(`^${host.replace(/[.*]/g, '\\$&')}\\n\\s+X-Robots-Tag: noindex$`, 'm'))
    }
    expect(headers).not.toMatch(/ream\.deityhub\.com/)
    expect(headers.match(/X-Robots-Tag/g)).toHaveLength(2) // nothing on the shared /* rule
  })

  test('the self-hosted NGINX site has no location for those addresses', () => {
    const conf = execFileSync(process.execPath, ['scripts/nginx-conf.ts'], { cwd: root, encoding: 'utf8' })
    expect(conf).not.toMatch(/pages\.dev|X-Robots-Tag|location [^\n]*https?:/)
    expect(conf).toMatch(/location = \/sw\.js/) // the other rules are still there
  })
})
