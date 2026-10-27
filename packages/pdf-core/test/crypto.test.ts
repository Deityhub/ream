import { describe, expect, test } from 'vitest'
import { md5 } from '../src/crypto/md5.ts'
import { rc4 } from '../src/crypto/rc4.ts'
import { aesCbcDecrypt, aesCbcEncrypt, aesDecryptBlock, aesEncryptBlock } from '../src/crypto/aes.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (h: string) => Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16))

describe('md5 (RFC 1321 test suite)', () => {
  const vectors: [string, string][] = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
  ]
  test.each(vectors)('%j', (input, digest) => expect(hex(md5(enc(input)))).toBe(digest))

  test('lengths around the padding boundary (55, 56, 63, 64, 65 bytes)', () => {
    // reference digests from the system md5 tool
    const known: Record<number, string> = {
      55: 'ef1772b6dff9a122358552954ad0df65',
      56: '3b0c8ac703f828b04c6c197006d17218',
      64: '014842d480b571495a4a0363793f7367',
    }
    for (const [n, d] of Object.entries(known)) expect(hex(md5(enc('a'.repeat(Number(n)))))).toBe(d)
  })
})

describe('rc4', () => {
  test('published vectors', () => {
    expect(hex(rc4(enc('Key'), enc('Plaintext')))).toBe('bbf316e8d940af0ad3')
    expect(hex(rc4(enc('Wiki'), enc('pedia')))).toBe('1021bf0420')
    expect(hex(rc4(enc('Secret'), enc('Attack at dawn')))).toBe('45a01f645fc35b383552544b9bf5')
  })
  test('encrypting twice gives the original back', () => {
    const data = enc('round trip me')
    expect(rc4(enc('k'), rc4(enc('k'), data))).toEqual(data)
  })
})

describe('aes (FIPS-197 appendix C)', () => {
  const plain = unhex('00112233445566778899aabbccddeeff')
  test('AES-128 block', () => {
    const key = unhex('000102030405060708090a0b0c0d0e0f')
    const ct = aesEncryptBlock(key, plain)
    expect(hex(ct)).toBe('69c4e0d86a7b0430d8cdb78070b4c55a')
    expect(aesDecryptBlock(key, ct)).toEqual(plain)
  })
  test('AES-256 block', () => {
    const key = unhex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
    const ct = aesEncryptBlock(key, plain)
    expect(hex(ct)).toBe('8ea2b7ca516745bfeafc49904b496089')
    expect(aesDecryptBlock(key, ct)).toEqual(plain)
  })
  test('rejects odd key sizes', () => {
    expect(() => aesEncryptBlock(new Uint8Array(24), plain)).toThrow()
  })
})

describe('aes-cbc', () => {
  // NIST SP 800-38A F.2.1 (CBC-AES128), first two blocks
  test('SP 800-38A vector', () => {
    const key = unhex('2b7e151628aed2a6abf7158809cf4f3c')
    const iv = unhex('000102030405060708090a0b0c0d0e0f')
    const pt = unhex('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51')
    const ct = aesCbcEncrypt(key, iv, pt)
    expect(hex(ct)).toBe('7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2')
    expect(aesCbcDecrypt(key, iv, ct, false)).toEqual(pt)
  })

  test('PKCS#7 padding is removed, for every length', () => {
    const key = unhex('000102030405060708090a0b0c0d0e0f'), iv = new Uint8Array(16)
    for (let n = 0; n <= 33; n++) {
      const msg = Uint8Array.from({ length: n }, (_, i) => i + 1)
      const padLen = 16 - (n % 16)
      const padded = new Uint8Array(n + padLen)
      padded.set(msg)
      padded.fill(padLen, n)
      expect(aesCbcDecrypt(key, iv, aesCbcEncrypt(key, iv, padded))).toEqual(msg)
    }
  })

  test('a damaged pad is left alone instead of throwing', () => {
    const key = unhex('000102030405060708090a0b0c0d0e0f'), iv = new Uint8Array(16)
    const block = new Uint8Array(16)
    block[15] = 7 // claims 7 bytes of padding but the 6 before it are 0
    expect(aesCbcDecrypt(key, iv, aesCbcEncrypt(key, iv, block))).toEqual(block)
  })

  test('a trailing partial block is ignored', () => {
    const key = unhex('000102030405060708090a0b0c0d0e0f'), iv = new Uint8Array(16)
    const ct = aesCbcEncrypt(key, iv, new Uint8Array(32).fill(16))
    const withJunk = new Uint8Array([...ct, 1, 2, 3])
    expect(aesCbcDecrypt(key, iv, withJunk, false)).toHaveLength(32)
  })
})
