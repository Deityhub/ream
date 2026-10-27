// AES-128/256 (FIPS-197) with CBC mode. Written out here so PDF decryption can stay synchronous
// (WebCrypto is async-only and insists on padding) and run anywhere, including React Native.

const SBOX = new Uint8Array(256)
const INV_SBOX = new Uint8Array(256)
{
  // generate the S-box from its definition instead of typing 256 constants
  const rotl8 = (x: number, n: number) => ((x << n) | (x >> (8 - n))) & 255
  let p = 1
  let q = 1
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 255 // p *= 3
    q = (q ^ (q << 1)) & 255 // q /= 3
    q = (q ^ (q << 2)) & 255
    q = (q ^ (q << 4)) & 255
    if (q & 0x80) q ^= 0x09
    SBOX[p] = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63
  } while (p !== 1)
  SBOX[0] = 0x63
  SBOX.forEach((v, i) => (INV_SBOX[v] = i))
}

const xtime = (a: number) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 255
function gmul(a: number, b: number): number {
  let r = 0
  for (; b; b >>= 1) {
    if (b & 1) r ^= a
    a = xtime(a)
  }
  return r
}
const table = (m: number) => Uint8Array.from({ length: 256 }, (_, i) => gmul(i, m))
const M2 = table(2), M3 = table(3), M9 = table(9), M11 = table(11), M13 = table(13), M14 = table(14)

/** round keys for a 16 or 32 byte key */
function expandKey(key: Uint8Array): { rk: Uint8Array; rounds: number } {
  if (key.length !== 16 && key.length !== 32) throw new Error('AES key must be 16 or 32 bytes')
  const nk = key.length / 4
  const rounds = nk + 6
  const rk = new Uint8Array(16 * (rounds + 1))
  rk.set(key)
  let rcon = 1
  for (let i = nk; i < 4 * (rounds + 1); i++) {
    const t = rk.slice((i - 1) * 4, i * 4)
    if (i % nk === 0) {
      t.set([SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]])
      rcon = xtime(rcon)
    } else if (nk > 6 && i % nk === 4) {
      for (let k = 0; k < 4; k++) t[k] = SBOX[t[k]]
    }
    for (let k = 0; k < 4; k++) rk[i * 4 + k] = rk[(i - nk) * 4 + k] ^ t[k]
  }
  return { rk, rounds }
}

function addRoundKey(s: Uint8Array, rk: Uint8Array, round: number) {
  for (let i = 0; i < 16; i++) s[i] ^= rk[round * 16 + i]
}

// state layout: s[row + 4 * column]
function shiftRows(s: Uint8Array, inverse: boolean) {
  const t = s.slice()
  for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) s[r + 4 * (inverse ? (c + r) % 4 : c)] = t[r + 4 * (inverse ? c : (c + r) % 4)]
}

function mixColumns(s: Uint8Array, inverse: boolean) {
  for (let c = 0; c < 16; c += 4) {
    const [a, b, d, e] = [s[c], s[c + 1], s[c + 2], s[c + 3]]
    if (inverse) {
      s[c] = M14[a] ^ M11[b] ^ M13[d] ^ M9[e]
      s[c + 1] = M9[a] ^ M14[b] ^ M11[d] ^ M13[e]
      s[c + 2] = M13[a] ^ M9[b] ^ M14[d] ^ M11[e]
      s[c + 3] = M11[a] ^ M13[b] ^ M9[d] ^ M14[e]
    } else {
      s[c] = M2[a] ^ M3[b] ^ d ^ e
      s[c + 1] = a ^ M2[b] ^ M3[d] ^ e
      s[c + 2] = a ^ b ^ M2[d] ^ M3[e]
      s[c + 3] = M3[a] ^ b ^ d ^ M2[e]
    }
  }
}

function encryptBlock(s: Uint8Array, rk: Uint8Array, rounds: number) {
  addRoundKey(s, rk, 0)
  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]
    shiftRows(s, false)
    if (r < rounds) mixColumns(s, false)
    addRoundKey(s, rk, r)
  }
}

function decryptBlock(s: Uint8Array, rk: Uint8Array, rounds: number) {
  addRoundKey(s, rk, rounds)
  for (let r = rounds - 1; r >= 0; r--) {
    shiftRows(s, true)
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]
    addRoundKey(s, rk, r)
    if (r > 0) mixColumns(s, true)
  }
}

/** one block, for known-answer tests */
export const aesEncryptBlock = (key: Uint8Array, block: Uint8Array) => {
  const { rk, rounds } = expandKey(key)
  const s = block.slice()
  encryptBlock(s, rk, rounds)
  return s
}
export const aesDecryptBlock = (key: Uint8Array, block: Uint8Array) => {
  const { rk, rounds } = expandKey(key)
  const s = block.slice()
  decryptBlock(s, rk, rounds)
  return s
}

/**
 * CBC decryption. With `unpad` the PKCS#7 padding is removed (what PDF strings and streams use); a damaged
 * pad is left in place rather than throwing, so a slightly broken file still opens.
 */
export function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array, unpad = true): Uint8Array {
  const { rk, rounds } = expandKey(key)
  const n = data.length - (data.length % 16)
  const out = new Uint8Array(n)
  const s = new Uint8Array(16)
  for (let off = 0; off < n; off += 16) {
    s.set(data.subarray(off, off + 16))
    decryptBlock(s, rk, rounds)
    const prev = off === 0 ? iv : data.subarray(off - 16, off)
    for (let i = 0; i < 16; i++) out[off + i] = s[i] ^ prev[i]
  }
  if (unpad && n > 0) {
    const pad = out[n - 1]
    if (pad >= 1 && pad <= 16 && out.subarray(n - pad).every((b) => b === pad)) return out.subarray(0, n - pad)
  }
  return out
}

/** CBC encryption without padding; the length must be a multiple of 16 (used by the R6 password hash) */
export function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length % 16) throw new Error('AES-CBC data must be a multiple of 16 bytes')
  const { rk, rounds } = expandKey(key)
  const out = new Uint8Array(data.length)
  const s = new Uint8Array(16)
  for (let off = 0; off < data.length; off += 16) {
    const prev = off === 0 ? iv : out.subarray(off - 16, off)
    for (let i = 0; i < 16; i++) s[i] = data[off + i] ^ prev[i]
    encryptBlock(s, rk, rounds)
    out.set(s, off)
  }
  return out
}
