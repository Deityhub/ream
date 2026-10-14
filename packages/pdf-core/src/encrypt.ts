// Writing a password-protected PDF with the standard security handler: AES-256 (revision 6, ISO 32000-2) or AES-128
// (revision 4). Everything is encrypted when the file is written; the rest of the document is written as it is.
import { PdfRef, PdfStream, PdfString, isName, name, type PdfObj } from './objects.ts'
import { PdfBuilder, zeroGen } from './writer.ts'
import { aesCbcEncrypt, aesEncryptBlock } from './crypto/aes.ts'
import { md5 } from './crypto/md5.ts'
import { rc4 } from './crypto/rc4.ts'
import { PAD, hash2B, padPassword, passwordBytes } from './security.ts'
import { PdfRangeError } from './errors.ts'
import type { PdfDocument } from './document.ts'

/** what a reader is asked to allow without the owner password (true = allowed) */
export type Permissions = { print: boolean; copy: boolean; modify: boolean }

export type EncryptOptions = {
  /** needed to open the file */
  userPassword: string
  /** lifts the restrictions; when empty and some are set, a random one nobody knows is used */
  ownerPassword?: string
  /** AES-256 unless 'aes128' asks for the older, more widely read form */
  method?: 'aes256' | 'aes128'
  permissions?: Partial<Permissions>
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}
const le32 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255)
const xorAll = (key: Uint8Array, v: number) => key.map((b) => b ^ v)
const ZERO_IV = new Uint8Array(16)
const str = (b: Uint8Array) => new PdfString(b, true)

/** the /P value: bits 7 and 8 and 13 up are set; the rest say what is allowed. Reading for accessibility is always allowed. */
export function permissionBits(p: Partial<Permissions> = {}): number {
  const { print = true, copy = true, modify = true } = p
  let bits = 0xfffff0c0 | 512
  if (print) bits |= 4 | 2048
  if (modify) bits |= 8 | 32 | 256 | 1024
  if (copy) bits |= 16
  return bits | 0
}

/** PKCS#7 padded AES-CBC with a fresh random IV in front, as PDF stores encrypted strings and streams */
function aesObject(key: Uint8Array, data: Uint8Array): Uint8Array {
  const pad = 16 - (data.length % 16)
  const padded = new Uint8Array(data.length + pad).fill(pad)
  padded.set(data)
  const iv = random(16)
  return concat(iv, aesCbcEncrypt(key, iv, padded))
}

type Keys = { dict: Map<string, PdfObj>; objectKey: (num: number, gen: number) => Uint8Array; id: Uint8Array }

async function aes256Keys(user: string, owner: string, p: number): Promise<Keys> {
  const fileKey = random(32)
  const up = passwordBytes(user, true)
  const op = passwordBytes(owner, true)
  const [uv, uk, ov, ok] = [random(8), random(8), random(8), random(8)]
  const U = concat(await hash2B(up, uv, new Uint8Array(0)), uv, uk)
  const UE = aesCbcEncrypt(await hash2B(up, uk, new Uint8Array(0)), ZERO_IV, fileKey)
  const O = concat(await hash2B(op, ov, U), ov, ok)
  const OE = aesCbcEncrypt(await hash2B(op, ok, U), ZERO_IV, fileKey)
  // /Perms: the permissions again, checked by readers; one block, encrypted with the file key
  const perms = concat(le32(p), Uint8Array.of(255, 255, 255, 255, 0x54, 0x61, 0x64, 0x62), random(4))
  const dict = new Map<string, PdfObj>([
    ['Filter', name('Standard')], ['V', 5], ['R', 6], ['Length', 256],
    ['CF', new Map<string, PdfObj>([['StdCF', new Map<string, PdfObj>([['CFM', name('AESV3')], ['AuthEvent', name('DocOpen')], ['Length', 32]])]])],
    ['StmF', name('StdCF')], ['StrF', name('StdCF')],
    ['O', str(O)], ['U', str(U)], ['OE', str(OE)], ['UE', str(UE)], ['Perms', str(aesEncryptBlock(fileKey, perms))], ['P', p],
  ])
  return { dict, objectKey: () => fileKey, id: random(16) }
}

function aes128Keys(user: string, owner: string, p: number): Keys {
  const id = random(16)
  const up = padPassword(passwordBytes(user, false))
  // algorithm 3: /O hides the padded user password under a key made from the owner password
  let h = md5(padPassword(passwordBytes(owner, false)))
  for (let i = 0; i < 50; i++) h = md5(h)
  const okey = h.slice(0, 16)
  let O = rc4(okey, up)
  for (let i = 1; i <= 19; i++) O = rc4(xorAll(okey, i), O)
  // algorithm 2: the file key
  let k = md5(concat(up, O, le32(p), id))
  for (let i = 0; i < 50; i++) k = md5(k.subarray(0, 16))
  const key = k.slice(0, 16)
  // algorithm 5: /U lets a reader check the password it was given
  let U = rc4(key, md5(concat(PAD, id)))
  for (let i = 1; i <= 19; i++) U = rc4(xorAll(key, i), U)
  const dict = new Map<string, PdfObj>([
    ['Filter', name('Standard')], ['V', 4], ['R', 4], ['Length', 128],
    ['CF', new Map<string, PdfObj>([['StdCF', new Map<string, PdfObj>([['CFM', name('AESV2')], ['AuthEvent', name('DocOpen')], ['Length', 16]])]])],
    ['StmF', name('StdCF')], ['StrF', name('StdCF')],
    ['O', str(O)], ['U', str(concat(U, new Uint8Array(16)))], ['P', p],
  ])
  const AES_SALT = Uint8Array.of(0x73, 0x41, 0x6c, 0x54)
  return { dict, id, objectKey: (num, gen) => md5(concat(key, Uint8Array.of(num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255), AES_SALT)).subarray(0, 16) }
}

/**
 * The document written again, protected: the user password opens it, the owner password lifts the restrictions in
 * `permissions` (which only well-behaved readers enforce). Pages, bookmarks, forms and the rest are kept as they are.
 */
export async function encryptPdf(doc: PdfDocument, o: EncryptOptions): Promise<Uint8Array> {
  if (!o.userPassword) throw new PdfRangeError('Enter a password.')
  const p = permissionBits(o.permissions)
  const restricted = o.permissions ? Object.values(o.permissions).some((v) => v === false) : false
  // without an owner password the restrictions still need one, so make one up; with no restrictions it can be the user's
  const owner = o.ownerPassword || (restricted ? Array.from(random(16), (b) => b.toString(16).padStart(2, '0')).join('') : o.userPassword)
  const keys = o.method === 'aes128' ? aes128Keys(o.userPassword, owner, p) : await aes256Keys(o.userPassword, owner, p)

  const root = doc.trailer.get('Root')
  if (!(root instanceof PdfRef)) throw new Error('The document has no catalog')
  const b = new PdfBuilder()
  const max = Math.max(0, ...doc.objects.keys())
  for (let n = 1; n <= max; n++) {
    const obj = doc.objects.get(n) ?? null
    const container = obj instanceof PdfStream && (isName(obj.dict.get('Type'), 'XRef') || isName(obj.dict.get('Type'), 'ObjStm'))
    if (container) {
      b.add(null)
      continue
    }
    const key = keys.objectKey(n, 0)
    const walk = (x: PdfObj): PdfObj => {
      if (x instanceof PdfString) return new PdfString(aesObject(key, x.bytes), x.hex)
      if (Array.isArray(x)) return x.map(walk)
      if (x instanceof PdfStream) return new PdfStream(walk(x.dict) as Map<string, PdfObj>, aesObject(key, x.data))
      if (x instanceof Map) return new Map([...x].map(([k, v]) => [k, walk(v)] as [string, PdfObj]))
      return x
    }
    b.add(walk(zeroGen(obj)))
  }
  const encrypt = b.add(keys.dict)
  const info = doc.trailer.get('Info')
  return b.serialize(new PdfRef(root.num), info instanceof PdfRef ? new PdfRef(info.num) : undefined, [
    ['Encrypt', encrypt],
    ['ID', [str(keys.id), str(keys.id)]],
  ])
}
