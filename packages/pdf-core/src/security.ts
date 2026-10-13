// PDF standard security handler (ISO 32000-1 section 7.6, ISO 32000-2 for AES-256): works out the file key from a
// user or owner password and decrypts strings and streams. Revisions 2 to 6: RC4 40/128, AES-128, AES-256.

import { PdfName, PdfStream, PdfString, isDict, isName, type PdfDict, type PdfObj } from './objects.ts'
import { PdfEncryptedError, PdfPasswordError } from './errors.ts'
import { md5 } from './crypto/md5.ts'
import { rc4 } from './crypto/rc4.ts'
import { aesCbcDecrypt, aesCbcEncrypt } from './crypto/aes.ts'

const PAD = Uint8Array.of(
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
)
const EMPTY = new Uint8Array(0)
const ZERO_IV = new Uint8Array(16)
const AES_SALT = Uint8Array.of(0x73, 0x41, 0x6c, 0x54) // "sAlT", added to per-object keys for AES

type Method = 'none' | 'rc4' | 'aes128' | 'aes256'

export type Decryptor = {
  string(bytes: Uint8Array, num: number, gen: number): Uint8Array
  stream(bytes: Uint8Array, num: number, gen: number): Uint8Array
  encryptMetadata: boolean
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])
const le32 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255)
const utf8 = (s: string) => new TextEncoder().encode(s)
const xorAll = (key: Uint8Array, v: number) => key.map((b) => b ^ v)
const sha = async (algo: 'SHA-256' | 'SHA-384' | 'SHA-512', data: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest(algo, data as BufferSource))

/** revisions up to 4 take the password as PDFDocEncoding (approximated by Latin-1), 5 and 6 as UTF-8 */
const passwordBytes = (pw: string, utf8Mode: boolean) =>
  utf8Mode ? utf8(pw).subarray(0, 127) : Uint8Array.from(Array.from(pw).flatMap((c) => (c.charCodeAt(0) <= 255 ? [c.charCodeAt(0)] : [...utf8(c)])))
const padPassword = (pw: Uint8Array) => concat(pw, PAD).subarray(0, 32)

/** ISO 32000-2 algorithm 2.B: the revision 6 password hash */
async function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = await sha('SHA-256', concat(password, salt, udata))
  let e: Uint8Array = EMPTY
  for (let i = 0; i < 64 || e[e.length - 1] > i - 32; i++) {
    const unit = concat(password, k, udata)
    const k1 = new Uint8Array(unit.length * 64)
    for (let r = 0; r < 64; r++) k1.set(unit, r * unit.length)
    e = aesCbcEncrypt(k.subarray(0, 16), k.subarray(16, 32), k1)
    // the first 16 bytes as a big number, mod 3, is just their sum mod 3 (256 = 1 mod 3)
    const mod = e.subarray(0, 16).reduce((s, b) => s + b, 0) % 3
    k = await sha(mod === 0 ? 'SHA-256' : mod === 1 ? 'SHA-384' : 'SHA-512', e)
  }
  return k.subarray(0, 32)
}

/**
 * Build a decryptor from the /Encrypt dictionary. `id0` is the first string of the trailer /ID.
 * Throws PdfPasswordError when neither the user nor the owner password matches, and PdfEncryptedError when
 * the dictionary is something we can't handle.
 */
export async function openSecurity(enc: PdfDict, id0: Uint8Array, password: string, resolve: (o: PdfObj) => PdfObj): Promise<Decryptor> {
  const get = (k: string) => resolve(enc.get(k) ?? null)
  const num = (k: string, d: number) => (typeof get(k) === 'number' ? (get(k) as number) : d)
  const bytes = (k: string) => {
    const v = get(k)
    return v instanceof PdfString ? v.bytes : EMPTY
  }
  const V = num('V', 0)
  const R = num('R', 0)
  const O = bytes('O')
  const U = bytes('U')
  if (!isName(get('Filter'), 'Standard') || ![1, 2, 4, 5].includes(V) || R < 2 || R > 6 || U.length < 32 || O.length < 32) {
    throw new PdfEncryptedError()
  }
  const P = num('P', 0) | 0
  const encryptMetadata = get('EncryptMetadata') !== false

  let streams: Method = 'rc4'
  let strings: Method = 'rc4'
  if (V >= 4) {
    const cf = get('CF')
    const method = (key: string): Method => {
      const n = get(key)
      const name = n instanceof PdfName ? n.value : 'Identity'
      if (name === 'Identity' || !isDict(cf)) return 'none'
      const filter = resolve(cf.get(name) ?? null)
      const cfm = isDict(filter) ? resolve(filter.get('CFM') ?? null) : null
      const m = cfm instanceof PdfName ? cfm.value : 'None'
      return m === 'V2' ? 'rc4' : m === 'AESV2' ? 'aes128' : m === 'AESV3' ? 'aes256' : 'none'
    }
    streams = method('StmF')
    strings = method('StrF')
  }

  const utf8Mode = R >= 5
  const given = passwordBytes(password, utf8Mode)
  const wrong = () => new PdfPasswordError(password !== '')
  let keyOf: (num: number, gen: number, aes: boolean) => Uint8Array

  if (R <= 4) {
    const n = V === 1 ? 5 : V === 4 ? 16 : Math.max(5, Math.min(16, num('Length', 40) / 8))
    // algorithm 2: file key from a (user) password
    const fileKey = (pw: Uint8Array) => {
      let h = md5(concat(padPassword(pw), O.subarray(0, 32), le32(P), id0, R >= 4 && !encryptMetadata ? Uint8Array.of(255, 255, 255, 255) : EMPTY))
      if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n))
      return h.slice(0, n)
    }
    // algorithms 4 and 5: does this key reproduce /U?
    const matchesU = (key: Uint8Array) => {
      if (R === 2) return same(rc4(key, PAD), U.subarray(0, 32))
      let x = rc4(key, md5(concat(PAD, id0)))
      for (let i = 1; i <= 19; i++) x = rc4(xorAll(key, i), x)
      return same(x, U.subarray(0, 16))
    }
    // algorithm 7: the user password hidden inside /O, recovered with the owner password
    const userFromOwner = (owner: Uint8Array) => {
      let h = md5(padPassword(owner))
      if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h)
      const okey = h.slice(0, R === 2 ? 5 : n)
      if (R === 2) return rc4(okey, O.subarray(0, 32))
      let x = O.subarray(0, 32)
      for (let i = 19; i >= 0; i--) x = rc4(xorAll(okey, i), x)
      return x
    }
    let key = fileKey(given)
    if (!matchesU(key)) {
      key = fileKey(userFromOwner(given))
      if (!matchesU(key)) throw wrong()
    }
    keyOf = (objNum, gen, aes) =>
      md5(concat(key, Uint8Array.of(objNum & 255, (objNum >> 8) & 255, (objNum >> 16) & 255, gen & 255, (gen >> 8) & 255), aes ? AES_SALT : EMPTY)).subarray(0, Math.min(n + 5, 16))
  } else {
    // revisions 5 and 6: the file key is stored encrypted in /UE (user) or /OE (owner)
    const hash = R === 5 ? async (p: Uint8Array, s: Uint8Array, u: Uint8Array) => sha('SHA-256', concat(p, s, u)) : hash2B
    const UE = bytes('UE')
    const OE = bytes('OE')
    const u48 = U.subarray(0, 48)
    let key: Uint8Array
    if (UE.length >= 32 && same(await hash(given, U.subarray(32, 40), EMPTY), U.subarray(0, 32))) {
      key = aesCbcDecrypt(await hash(given, U.subarray(40, 48), EMPTY), ZERO_IV, UE.subarray(0, 32), false)
    } else if (OE.length >= 32 && O.length >= 48 && same(await hash(given, O.subarray(32, 40), u48), O.subarray(0, 32))) {
      key = aesCbcDecrypt(await hash(given, O.subarray(40, 48), u48), ZERO_IV, OE.subarray(0, 32), false)
    } else throw wrong()
    keyOf = () => key
  }

  const apply = (method: Method, data: Uint8Array, objNum: number, gen: number) => {
    if (method === 'none') return data
    if (method === 'rc4') return rc4(keyOf(objNum, gen, false), data)
    if (data.length < 16) return EMPTY
    return aesCbcDecrypt(keyOf(objNum, gen, method === 'aes128'), data.subarray(0, 16), data.subarray(16))
  }
  return {
    encryptMetadata,
    string: (b, n, g) => apply(strings, b, n, g),
    stream: (b, n, g) => apply(streams, b, n, g),
  }
}

/** a stream whose data stays as stored: unencrypted metadata, or one with an Identity crypt filter */
function leaveAlone(s: PdfStream, dec: Decryptor): boolean {
  if (isName(s.dict.get('Type'), 'Metadata') && !dec.encryptMetadata) return true
  const filter = s.dict.get('Filter')
  const filters = Array.isArray(filter) ? filter : [filter]
  const at = filters.findIndex((f) => isName(f, 'Crypt'))
  if (at < 0) return false
  const parms = s.dict.get('DecodeParms')
  const p = Array.isArray(parms) ? parms[at] : parms
  const name = isDict(p) ? p.get('Name') : null
  return !name || isName(name, 'Identity')
}

/** decrypt every string and stream in place (objects inside object streams are plain once their stream is decrypted) */
export function decryptObjects(objects: Map<number, PdfObj>, gens: Map<number, number>, dec: Decryptor, skip: number): void {
  const walk = (o: PdfObj, num: number, gen: number): PdfObj => {
    if (o instanceof PdfString) return new PdfString(dec.string(o.bytes, num, gen), o.hex)
    if (Array.isArray(o)) return o.map((x) => walk(x, num, gen))
    if (o instanceof Map) {
      for (const [k, v] of o) o.set(k, walk(v, num, gen))
      return o
    }
    return o
  }
  for (const [num, o] of objects) {
    // the encryption dictionary itself and xref streams are never encrypted
    if (num === skip || (o instanceof PdfStream && isName(o.dict.get('Type'), 'XRef'))) continue
    const gen = gens.get(num) ?? 0
    if (o instanceof PdfStream) {
      const skipData = leaveAlone(o, dec)
      walk(o.dict, num, gen)
      if (!skipData) o.data = dec.stream(o.data, num, gen)
    } else {
      objects.set(num, walk(o, num, gen))
    }
  }
}
