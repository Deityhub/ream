import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfEncryptedError, PdfPasswordError, PdfStream, decodeStream, decryptPdf, merge } from '../src/index.ts'
import { encryptedPdf } from './helpers.ts'

// Encrypted by pypdf (an independent implementation) from cups.pdf; see scripts/make-encrypted-fixtures.py.
// User password "user123", owner password "owner456".
const USER = 'user123'
const OWNER = 'owner456'
const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', name)))

/** decoded bytes of every page's content streams: equal before and after encryption if decryption is right */
async function contents(doc: PdfDocument): Promise<number[][]> {
  const out: number[][] = []
  for (const page of doc.pages()) {
    const c = [doc.resolve(page.dict.get('Contents'))].flat().map((x) => doc.resolve(x))
    const parts: number[] = []
    for (const s of c) if (s instanceof PdfStream) parts.push(...(await decodeStream(s)))
    out.push(parts)
  }
  return out
}

const original = await PdfDocument.load(fixture('cups.pdf'))
const expected = await contents(original)
const locked = ['enc-rc4-40.pdf', 'enc-rc4-128.pdf', 'enc-aes-128.pdf', 'enc-aes-256-r5.pdf', 'enc-aes-256.pdf']

test('the original really has content to compare', () => {
  expect(expected).toHaveLength(3)
  expect(expected.every((c) => c.length > 100)).toBe(true)
})

describe.each(locked)('%s', (name) => {
  const bytes = fixture(name)

  test('no password: asks for one', async () => {
    const e = await PdfDocument.load(bytes).catch((x) => x)
    expect(e).toBeInstanceOf(PdfPasswordError)
    expect(e.incorrect).toBe(false)
    expect(e.message).toBe('This PDF is password protected.')
  })

  test('wrong password: says so', async () => {
    const e = await PdfDocument.load(bytes, { password: 'nope' }).catch((x) => x)
    expect(e).toBeInstanceOf(PdfPasswordError)
    expect(e.incorrect).toBe(true)
    expect(e.message).toBe("That password isn't right.")
  })

  test('user password opens it and the page content is identical to the original', async () => {
    const doc = await PdfDocument.load(bytes, { password: USER })
    expect(doc.encrypted).toBe(true)
    expect(doc.trailer.has('Encrypt')).toBe(false)
    expect(doc.pages()).toHaveLength(3)
    expect(await contents(doc)).toEqual(expected)
  })

  test('owner password opens it too', async () => {
    expect(await contents(await PdfDocument.load(bytes, { password: OWNER }))).toEqual(expected)
  })

  test('decryptPdf gives a plain PDF that loads without a password', async () => {
    const plain = await decryptPdf(bytes, USER)
    expect(new TextDecoder('latin1').decode(plain)).not.toContain('/Encrypt')
    const doc = await PdfDocument.load(plain)
    expect(doc.encrypted).toBe(false)
    expect(await contents(doc)).toEqual(expected)
  })

  test('decryptPdf with the wrong password throws instead of returning garbage', async () => {
    await expect(decryptPdf(bytes, 'wrong')).rejects.toBeInstanceOf(PdfPasswordError)
  })

  test('tools work on the opened document: merge with itself', async () => {
    const doc = await PdfDocument.load(bytes, { password: USER })
    const merged = await PdfDocument.load(merge([{ doc }, { doc: original }]))
    expect(merged.pages()).toHaveLength(6)
    expect(await contents(merged)).toEqual([...expected, ...expected])
  })
})

describe('owner-only protection (empty user password)', () => {
  const bytes = fixture('enc-owner-only.pdf')
  test('opens with no password at all, decrypted', async () => {
    const doc = await PdfDocument.load(bytes)
    expect(doc.encrypted).toBe(true)
    expect(await contents(doc)).toEqual(expected)
  })
  test('the owner password works as well; an unrelated one does not', async () => {
    expect(await contents(await PdfDocument.load(bytes, { password: OWNER }))).toEqual(expected)
    await expect(PdfDocument.load(bytes, { password: 'other' })).rejects.toBeInstanceOf(PdfPasswordError)
  })
})

describe('other cases', () => {
  test('an unencrypted file is returned untouched by decryptPdf', async () => {
    const bytes = fixture('cups.pdf')
    expect(await decryptPdf(bytes, '')).toBe(bytes)
    expect(original.encrypted).toBe(false)
  })

  test('an /Encrypt entry we cannot interpret is reported as unsupported, not as a wrong password', async () => {
    const e = await PdfDocument.load(encryptedPdf(['A'])).catch((x) => x)
    expect(e).toBeInstanceOf(PdfEncryptedError)
    expect(e.message).toBe("This PDF uses protection Ream can't open yet.")
  })

  test('a damaged cross-reference table still decrypts (rebuild path)', async () => {
    const text = new TextDecoder('latin1').decode(fixture('enc-aes-128.pdf')).replace(/startxref\s+\d+/, 'startxref\n1')
    const broken = Uint8Array.from(text, (c) => c.charCodeAt(0))
    expect(await contents(await PdfDocument.load(broken, { password: USER }))).toEqual(expected)
  })
})
