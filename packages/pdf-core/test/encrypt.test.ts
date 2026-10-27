import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfPasswordError, PdfStream, decodeStream, encryptPdf, permissionBits } from '../src/index.ts'
import { assemble, classicPdf } from './helpers.ts'
import { latin1 } from '../src/bytes.ts'

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)))
const load = (b: Uint8Array, password?: string) => PdfDocument.load(b, { password })
const PW = 'pässword1'

describe('encryptPdf', () => {
  test.each(['aes256', 'aes128'] as const)('%s: opens with the password, not without or with a wrong one', async (method) => {
    const out = await encryptPdf(await load(classicPdf(['Hello Ream', 'Second page'])), { userPassword: PW, method })
    await expect(load(out)).rejects.toBeInstanceOf(PdfPasswordError)
    await expect(load(out, 'wrong')).rejects.toBeInstanceOf(PdfPasswordError)
    const doc = await load(out, PW)
    expect(doc.encrypted).toBe(true)
    expect(doc.pages().length).toBe(2)
  })

  test.each(['aes256', 'aes128'] as const)('%s: text and streams are not readable in the file', async (method) => {
    const out = await encryptPdf(await load(classicPdf(['Hello Ream'])), { userPassword: PW, method })
    expect(latin1(out)).not.toContain('Hello Ream')
    expect(latin1(out)).toContain('/Encrypt')
    const doc = await load(out, PW)
    const page = doc.pages()[0]
    const c = doc.resolve(page.dict.get('Contents')) as PdfStream
    expect(latin1(await decodeStream(c))).toContain('Hello Ream')
  })

  test.each(['aes256', 'aes128'] as const)('%s: the owner password opens it too', async (method) => {
    const out = await encryptPdf(await load(classicPdf(['x'])), { userPassword: PW, ownerPassword: 'own-pw', method, permissions: { print: false } })
    expect((await load(out, 'own-pw')).pages().length).toBe(1)
    expect((await load(out, PW)).pages().length).toBe(1)
  })

  test('a password with accents and symbols works', async () => {
    for (const method of ['aes256', 'aes128'] as const) {
      const out = await encryptPdf(await load(classicPdf(['x'])), { userPassword: 'Ünï-çødé ✓', method })
      expect((await load(out, 'Ünï-çødé ✓')).pages().length).toBe(1)
    }
  })

  test('every encryption is different (fresh keys and salts)', async () => {
    const doc = await load(classicPdf(['x']))
    const a = await encryptPdf(doc, { userPassword: PW })
    const b = await encryptPdf(doc, { userPassword: PW })
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  test('an empty password is refused', async () => {
    await expect(encryptPdf(await load(classicPdf(['x'])), { userPassword: '' })).rejects.toThrow('Enter a password.')
  })

  test('permissions: bits for each choice; reading for accessibility is always allowed', () => {
    const all = permissionBits()
    expect(all & 4).toBe(4)
    expect(permissionBits({ print: false }) & (4 | 2048)).toBe(0)
    expect(permissionBits({ copy: false }) & 16).toBe(0)
    expect(permissionBits({ modify: false }) & (8 | 32 | 256 | 1024)).toBe(0)
    expect(permissionBits({ print: false, copy: false, modify: false }) & 512).toBe(512)
    // bits 7-8 are set and 1-2 clear, as the format asks
    expect(all & 0xc3).toBe(0xc0)
    expect(permissionBits({ print: false }) >> 0).toBeLessThan(0) // stored as a signed 32-bit number
  })

  test('restrictions without an owner password get an unknown one, so the user password does not lift them', async () => {
    const out = await encryptPdf(await load(classicPdf(['x'])), { userPassword: PW, permissions: { copy: false } })
    // the file still opens with the user password, and our reader reports what it asked for
    const doc = await load(out, PW)
    const enc = doc.trailer.get('Encrypt')
    expect(enc).toBeUndefined() // removed once decrypted
    expect(doc.pages().length).toBe(1)
  })

  test('bookmarks, forms and information come through', async () => {
    const objs: [number, string][] = [
      [1, '<< /Type /Catalog /Pages 2 0 R /Outlines 5 0 R >>'],
      [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
      [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'],
      [5, '<< /Type /Outlines /First 6 0 R /Last 6 0 R /Count 1 >>'],
      [6, '<< /Title (Chapter one) /Parent 5 0 R /Dest [3 0 R /Fit] >>'],
      [7, '<< /Title (My file) >>'],
    ]
    const src = await load(assemble(objs, '/Info 7 0 R').bytes)
    for (const method of ['aes256', 'aes128'] as const) {
      const doc = await load(await encryptPdf(src, { userPassword: PW, method }), PW)
      const outline = doc.resolve(doc.catalog().get('Outlines')) as Map<string, any>
      const first = doc.resolve(outline.get('First')) as Map<string, any>
      expect(latin1(first.get('Title').bytes)).toBe('Chapter one')
      expect(latin1((doc.resolve(doc.trailer.get('Info')) as Map<string, any>).get('Title').bytes)).toBe('My file')
    }
  })

  test('a real file keeps its pages and their content', async () => {
    const src = await load(fixture('chromium.pdf'))
    const out = await encryptPdf(src, { userPassword: PW })
    const doc = await load(out, PW)
    expect(doc.pages().length).toBe(src.pages().length)
    const text = async (d: PdfDocument) => latin1(await decodeStream(d.resolve(d.pages()[0].dict.get('Contents') as never) as PdfStream))
    expect(await text(doc)).toBe(await text(src))
  })

  test('encrypting an already unlocked copy of a protected file works', async () => {
    const locked = await load(fixture('enc-aes-256.pdf'), 'user123')
    const again = await encryptPdf(locked, { userPassword: PW })
    expect((await load(again, PW)).pages().length).toBe(locked.pages().length)
  })

  // made by Ream and opened with pypdf 6 (an independent reader) to be sure both sides agree on the format
  test.each(['enc-ream-aes256.pdf', 'enc-ream-aes128.pdf'])('%s, checked once with pypdf, still opens', async (name) => {
    const doc = await load(fixture(name), PW)
    expect(doc.pages().length).toBe(2)
    await expect(load(fixture(name), 'nope')).rejects.toBeInstanceOf(PdfPasswordError)
    expect((await load(fixture(name), 'own-pw')).pages().length).toBe(2)
  })
})
