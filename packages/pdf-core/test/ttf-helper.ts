// A tiny TrueType font made in code, so font tests need no font file: .notdef, space, A, Ж (Cyrillic) and Á (a composite of A and an accent).
const be16 = (n: number) => [(n >> 8) & 255, n & 255]
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat())
const sbe16 = (n: number) => be16(n & 0xffff)

const rect = (x0: number, y0: number, x1: number, y1: number) =>
  bytes(sbe16(1), sbe16(x0), sbe16(y0), sbe16(x1), sbe16(y1), be16(3), be16(0), [1, 1, 1, 1], sbe16(x0), sbe16(x1 - x0), sbe16(0), sbe16(x0 - x1), sbe16(y0), sbe16(0), sbe16(y1 - y0), sbe16(0))

const composite = (a: number, b: number, dx: number, dy: number) =>
  bytes(sbe16(-1), sbe16(0), sbe16(0), sbe16(600), sbe16(900), be16(0x0001 | 0x0002 | 0x0020), be16(a), sbe16(0), sbe16(0), be16(0x0001 | 0x0002), be16(b), sbe16(dx), sbe16(dy))

export const GLYPHS = { notdef: 0, space: 1, A: 2, Zhe: 3, accent: 4, Aacute: 5 }
const ADVANCE = [500, 250, 600, 700, 300, 600]

/**
 * `cff` makes it an OpenType font with PostScript outlines instead (`makeCff`: name-keyed, or CID-keyed with ROS).
 */
export function makeTtf(options: { fsType?: number; sfnt?: string; cff?: 'plain' | 'cid'; /** a symbol font: one (3,0) cmap with the letters at 0xF000 up */ symbol?: boolean } = {}): Uint8Array {
  const glyphs = [new Uint8Array(0), new Uint8Array(0), rect(50, 0, 550, 700), rect(40, 0, 660, 700), rect(100, 750, 300, 900), composite(GLYPHS.A, GLYPHS.accent, 0, 0)]
  const glyf: number[] = []
  const loca: number[] = []
  for (const g of glyphs) {
    loca.push(...be16(glyf.length / 2))
    glyf.push(...g)
  }
  loca.push(...be16(glyf.length / 2))
  const maps: [number, number][] = options.symbol ? [[0xf020, 1], [0xf041, 2], [0xffff, 0]] : [[32, 1], [65, 2], [0xc1, 5], [0x416, 3], [0xffff, 0]]
  const seg = maps.length
  const cmap4 = bytes(
    be16(4), be16(16 + seg * 8), be16(0), be16(seg * 2), be16(0), be16(0), be16(0),
    maps.flatMap(([cp]) => be16(cp)), be16(0), maps.flatMap(([cp]) => be16(cp)), maps.flatMap(([cp, g]) => be16((g - cp) & 0xffff)), maps.flatMap(() => be16(0)),
  )
  const cmap = bytes(be16(0), be16(1), be16(3), be16(options.symbol ? 0 : 1), be32(12), [...cmap4])
  const head = bytes(be32(0x00010000), be32(0x00010000), be32(0), be32(0x5f0f3cf5), be16(0), be16(1000), new Array(16).fill(0), sbe16(0), sbe16(0), sbe16(700), sbe16(900), be16(0), be16(8), sbe16(2), sbe16(0), sbe16(0))
  const hhea = bytes(be32(0x00010000), sbe16(800), sbe16(-200), sbe16(0), be16(700), sbe16(0), sbe16(0), be16(700), sbe16(1), sbe16(0), sbe16(0), new Array(8).fill(0), sbe16(0), be16(glyphs.length))
  const maxp = bytes(be32(0x00010000), be16(glyphs.length), new Array(26).fill(0))
  const hmtx = bytes(ADVANCE.flatMap((a) => [...be16(a), ...sbe16(0)]))
  const nameStr = [...'TestFont'].flatMap((c) => be16(c.charCodeAt(0)))
  const name = bytes(be16(0), be16(1), be16(18), be16(3), be16(1), be16(0x409), be16(6), be16(nameStr.length), be16(0), nameStr)
  const post = bytes(be32(0x00030000), be32(0), new Array(24).fill(0))
  const os2 = bytes(be16(0), sbe16(500), be16(400), be16(5), be16(options.fsType ?? 0), new Array(68).fill(0))
  const cff = makeCff({ cid: options.cff === 'cid' })
  const outlines: [string, Uint8Array][] = options.cff ? [['CFF ', cff]] : [['glyf', Uint8Array.from(glyf)], ['loca', Uint8Array.from(loca)]]
  const tables: [string, Uint8Array][] = [['OS/2', os2], ...outlines, ['cmap', cmap], ['head', head], ['hhea', hhea], ['hmtx', hmtx], ['maxp', maxp], ['name', name], ['post', post]]
  if (options.cff) options.sfnt = 'OTTO'
  return sfnt(tables, options.sfnt)
}

/** a font file from its tables (`tag` 'OTTO' for CFF outlines) */
export function sfnt(tables: [string, Uint8Array][], tag?: string): Uint8Array {
  const pad = (b: Uint8Array) => (b.length % 4 ? Uint8Array.from([...b, ...new Array(4 - (b.length % 4)).fill(0)]) : b)
  const dirLen = 12 + tables.length * 16
  let at = dirLen
  const dir: number[] = [...(tag ? [...tag].map((c) => c.charCodeAt(0)) : be32(0x00010000)), ...be16(tables.length), ...be16(128), ...be16(3), ...be16(tables.length * 16 - 128)]
  const body: number[] = []
  for (const [tag, data] of tables) {
    dir.push(...[...tag].map((c) => c.charCodeAt(0)), ...be32(0), ...be32(at), ...be32(data.length))
    const p = pad(data)
    body.push(...p)
    at += p.length
  }
  return Uint8Array.from([...dir, ...body])
}

/** a TrueType glyph of one contour, from points [x, y, onCurve] (coordinates written as plain 16-bit deltas) */
export function glyphOf(points: [number, number, boolean][]): Uint8Array {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const deltas = (v: number[]) => v.flatMap((x, i) => sbe16(x - (i ? v[i - 1] : 0)))
  return bytes(sbe16(1), sbe16(Math.min(...xs)), sbe16(Math.min(...ys)), sbe16(Math.max(...xs)), sbe16(Math.max(...ys)), be16(points.length - 1), be16(0), points.map((p) => (p[2] ? 1 : 0)), deltas(xs), deltas(ys))
}

/** a bare TrueType program of just head, loca and glyf, as PDFs often embed them */
export function glyphsOnly(glyphs: Uint8Array[]): Uint8Array {
  const glyf: number[] = []
  const loca: number[] = []
  for (const g of glyphs) {
    loca.push(...be32(glyf.length))
    glyf.push(...g, ...new Array(g.length % 2).fill(0))
  }
  loca.push(...be32(glyf.length))
  const head = bytes(be32(0x00010000), be32(0x00010000), be32(0), be32(0x5f0f3cf5), be16(0), be16(1000), new Array(16).fill(0), new Array(8).fill(0), be16(0), be16(8), sbe16(2), sbe16(1), sbe16(0))
  return sfnt([['glyf', Uint8Array.from(glyf)], ['head', head], ['loca', Uint8Array.from(loca)]])
}

// ---------- CFF (Type 2 charstrings) ----------

/** a Type 2 charstring number */
const t2 = (n: number): number[] => {
  if (n >= -107 && n <= 107) return [n + 139]
  if (n >= 108 && n <= 1131) return [247 + ((n - 108) >> 8), (n - 108) & 255]
  if (n <= -108 && n >= -1131) return [251 + ((-n - 108) >> 8), (-n - 108) & 255]
  return [28, ...sbe16(n)]
}
const op = (...parts: (number | number[])[]) => parts.flatMap((p) => (Array.isArray(p) ? p : t2(p)))
/** a DICT entry with fixed-size integers, so offsets can be worked out before they are known */
const entry = (key: number, ...values: number[]) => [...values.flatMap((v) => [29, ...be32(v)]), ...(key >= 1200 ? [12, key - 1200] : [key])]
const index = (items: number[][]) => {
  if (!items.length) return [0, 0]
  const offs = [1]
  for (const it of items) offs.push(offs[offs.length - 1] + it.length)
  return [...be16(items.length), 4, ...offs.flatMap(be32), ...items.flat()]
}

/** CFF glyphs: .notdef, space, A (a box drawn through a subroutine), acute, Aacute (seac in endchar), O (hflex) */
export const CFF_GLYPHS = { notdef: 0, space: 1, A: 2, acute: 3, Aacute: 4, O: 5 }

/**
 * A small CFF font program. Name-keyed glyphs are named by standard strings (space, A, acute, Aacute, O); CID-keyed
 * ones (`cid`) are CIDs 100 to 104, with one font dict and FDSelect.
 */
export function makeCff(options: { cid?: boolean } = {}): Uint8Array {
  const charStrings = [
    op([14]),
    op(250, [14]),
    op(600, 50, 0, [21], -107, [10], -500, [6], [14]), // width 600, then the box through subroutine 0
    op(100, 750, [21], 200, [6], 150, [7], -200, [6], [14]),
    op(100, 0, 65, 194, [14]),
    op(0, 0, [21], 100, 100, 50, 100, 100, 100, 100, [12, 34], [14]),
  ]
  const subrs = index([op(500, [6], 700, [7], [11])])
  const n = charStrings.length
  const charset = options.cid ? [2, ...be16(100), ...be16(n - 2)] : [0, ...[1, 34, 125, 171, 48].flatMap(be16)]
  const header = [1, 0, 4, 1]
  const names = index([[...'Test'].map((c) => c.charCodeAt(0))])
  const empty = [0, 0]
  const charIndex = index(charStrings)
  // the private DICT, its Subrs right after it
  const priv = (size: number) => entry(19, size)
  const privSize = priv(0).length
  const build = (offs: { charset: number; chars: number; priv: number; fdArray: number; fdSelect: number }) =>
    options.cid
      ? [...entry(1230, 1, 1, 0), ...entry(15, offs.charset), ...entry(17, offs.chars), ...entry(1236, offs.fdArray), ...entry(1237, offs.fdSelect)]
      : [...entry(15, offs.charset), ...entry(17, offs.chars), ...entry(18, privSize, offs.priv)]
  const topLen = index([build({ charset: 0, chars: 0, priv: 0, fdArray: 0, fdSelect: 0 })]).length
  let at = header.length + names.length + topLen + empty.length + empty.length
  const charsetAt = at
  at += charset.length
  const charsAt = at
  at += charIndex.length
  const privAt = at
  at += privSize + subrs.length
  const fdDict = entry(18, privSize, privAt)
  const fdArray = index([fdDict])
  const fdArrayAt = at
  at += options.cid ? fdArray.length : 0
  const fdSelectAt = at
  const fdSelect = [3, ...be16(1), ...be16(0), 0, ...be16(n)]
  const top = index([build({ charset: charsetAt, chars: charsAt, priv: privAt, fdArray: fdArrayAt, fdSelect: fdSelectAt })])
  return Uint8Array.from([...header, ...names, ...top, ...empty, ...empty, ...charset, ...charIndex, ...priv(privSize), ...subrs, ...(options.cid ? [...fdArray, ...fdSelect] : [])])
}

// ---------- Type 1 ----------

const t1 = (n: number): number[] => (n >= -1131 && n <= 1131 ? t2(n) : [255, ...be32(n)])
const op1 = (...parts: (number | number[])[]) => parts.flatMap((p) => (Array.isArray(p) ? p : t1(p)))

function encrypt(plain: number[], key: number, prefix: number): number[] {
  let r = key
  return [...new Array(prefix).fill(0), ...plain].map((p) => {
    const c = p ^ (r >> 8)
    r = ((c + r) * 52845 + 22719) & 0xffff
    return c
  })
}

/**
 * A small Type 1 font program as a PDF embeds it (FontFile, `length1` is its cleartext part): .notdef, A (a box drawn
 * through subroutine 4), acute, Aacute (seac) and O (a flex through the standard subroutines 0 to 3). Its own encoding
 * puts A at 65 and O at 66.
 */
export function makeType1(): { bytes: Uint8Array; length1: number; length2: number } {
  const subrs = [
    op1(3, 0, [12, 16], [12, 17], [12, 17], [12, 33], [11]),
    op1(0, 1, [12, 16], [11]),
    op1(0, 2, [12, 16], [11]),
    op1([11]),
    op1(500, [6], 700, [7], [11]),
  ]
  const flexMoves = [[100, 0], [0, 50], [100, 0], [100, -50], [100, 0], [100, 50], [100, -50]]
  const glyphs: [string, number[]][] = [
    ['.notdef', op1(0, 500, [13], [14])],
    ['A', op1(50, 600, [13], 0, 0, [21], 4, [10], -500, [6], [9], [14])],
    ['acute', op1(100, 300, [13], 0, 750, [21], 200, [6], 150, [7], -200, [6], [9], [14])],
    ['Aacute', op1(50, 600, [13], 100, 150, 0, 65, 194, [12, 6])],
    ['O', op1(0, 700, [13], 0, 0, [21], 1, [10], ...flexMoves.map(([dx, dy]) => op1(dx, dy, [21], 2, [10])), 50, 600, 0, 0, [10], [9], [14])],
  ]
  const latin = (s: string) => [...s].map((c) => c.charCodeAt(0))
  const cs = (b: number[]) => encrypt(b, 4330, 4)
  const priv: number[] = latin('dup /Private 8 dict dup begin\n/RD{string currentfile exch readstring pop}executeonly def\n/ND{noaccess def}executeonly def\n/NP{noaccess put}executeonly def\n/BlueValues [] def\n/MinFeature {16 16} def\n/password 5839 def\n/lenIV 4 def\n')
  priv.push(...latin(`/Subrs ${subrs.length} array\n`))
  subrs.forEach((s, i) => {
    const e = cs(s)
    priv.push(...latin(`dup ${i} ${e.length} RD `), ...e, ...latin(' NP\n'))
  })
  priv.push(...latin(`ND\n2 index /CharStrings ${glyphs.length} dict dup begin\n`))
  for (const [name, g] of glyphs) {
    const e = cs(g)
    priv.push(...latin(`/${name} ${e.length} RD `), ...e, ...latin(' ND\n'))
  }
  priv.push(...latin('end\nend\nreadonly put\nnoaccess put\ndup /FontName get exch definefont pop\nmark currentfile closefile\n'))
  const clear = latin('%!PS-AdobeFont-1.0: Test 001.000\n12 dict begin\n/FontType 1 def\n/PaintType 0 def\n/FontBBox {0 0 700 900} readonly def\n/FontName /Test def\n/FontMatrix [0.001 0 0 0.001 0 0] readonly def\n/Encoding 256 array\n0 1 255 {1 index exch /.notdef put} for\ndup 65 /A put\ndup 66 /O put\nreadonly def\ncurrentdict end\ncurrentfile eexec\n')
  const trailer = latin(`${'0'.repeat(64)}\n`.repeat(8) + 'cleartomark\n')
  const body = encrypt(priv, 55665, 4)
  return { bytes: Uint8Array.from([...clear, ...body, ...trailer]), length1: clear.length, length2: body.length }
}
