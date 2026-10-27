import { expect, test } from 'vitest'
import { UserError } from '@ream/core'
import { dig, esc, kids, num, parseXml } from '../src/index.ts'

test('reads elements, attributes, text, entities, CDATA; prefixes dropped; comments skipped', () => {
  const x = parseXml(`<?xml version="1.0"?>
    <w:doc xmlns:w="urn:x" w:v='1'><!-- c --><w:p a="x &gt; y"><w:t>A &amp; B &#65;&#x42;</w:t><w:br/></w:p><w:p><![CDATA[<raw>]]></w:p></w:doc>`)
  expect(x.name).toBe('doc')
  expect(x.attrs).toEqual({ v: '1' })
  const ps = kids(x, 'p')
  expect(ps).toHaveLength(2)
  expect(ps[0].attrs.a).toBe('x > y')
  expect(dig(ps[0], 't')?.text).toBe('A & B AB')
  expect(ps[0].children.map((c) => c.name)).toEqual(['t', 'br'])
  expect(ps[1].text).toBe('<raw>')
})

test('attribute values may contain > and the number helper falls back', () => {
  const x = parseXml('<a b="1>2" n="12.5"/>')
  expect(x.attrs.b).toBe('1>2')
  expect(num(x, 'n')).toBe(12.5)
  expect(num(x, 'missing', 7)).toBe(7)
  expect(num(undefined, 'n', 3)).toBe(3)
})

test('refuses DOCTYPE, broken nesting, unclosed tags and several roots', () => {
  for (const s of ['<!DOCTYPE a [<!ENTITY x "y">]><a/>', '<a><b></a></b>', '<a><b>', '<a/><b/>', '', '<a b=1/>']) {
    expect(() => parseXml(s), s).toThrow(UserError)
  }
})

test('esc drops characters XML cannot hold and escapes markup', () => {
  expect(esc('a<b>&"c"\u0000\u0007\n')).toBe('a&lt;b&gt;&amp;&quot;c&quot;\n')
  expect(parseXml(`<a>${esc('x & <y>')}</a>`).text).toBe('x & <y>')
})

test('depth is capped', () => {
  expect(() => parseXml('<a>'.repeat(500) + '</a>'.repeat(500))).toThrow(UserError)
})
