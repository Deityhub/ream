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

export function makeTtf(options: { fsType?: number; sfnt?: string } = {}): Uint8Array {
  const glyphs = [new Uint8Array(0), new Uint8Array(0), rect(50, 0, 550, 700), rect(40, 0, 660, 700), rect(100, 750, 300, 900), composite(GLYPHS.A, GLYPHS.accent, 0, 0)]
  const glyf: number[] = []
  const loca: number[] = []
  for (const g of glyphs) {
    loca.push(...be16(glyf.length / 2))
    glyf.push(...g)
  }
  loca.push(...be16(glyf.length / 2))
  const maps: [number, number][] = [[32, 1], [65, 2], [0xc1, 5], [0x416, 3], [0xffff, 0]]
  const seg = maps.length
  const cmap4 = bytes(
    be16(4), be16(16 + seg * 8), be16(0), be16(seg * 2), be16(0), be16(0), be16(0),
    maps.flatMap(([cp]) => be16(cp)), be16(0), maps.flatMap(([cp]) => be16(cp)), maps.flatMap(([cp, g]) => be16((g - cp) & 0xffff)), maps.flatMap(() => be16(0)),
  )
  const cmap = bytes(be16(0), be16(1), be16(3), be16(1), be32(12), [...cmap4])
  const head = bytes(be32(0x00010000), be32(0x00010000), be32(0), be32(0x5f0f3cf5), be16(0), be16(1000), new Array(16).fill(0), sbe16(0), sbe16(0), sbe16(700), sbe16(900), be16(0), be16(8), sbe16(2), sbe16(0), sbe16(0))
  const hhea = bytes(be32(0x00010000), sbe16(800), sbe16(-200), sbe16(0), be16(700), sbe16(0), sbe16(0), be16(700), sbe16(1), sbe16(0), sbe16(0), new Array(8).fill(0), sbe16(0), be16(glyphs.length))
  const maxp = bytes(be32(0x00010000), be16(glyphs.length), new Array(26).fill(0))
  const hmtx = bytes(ADVANCE.flatMap((a) => [...be16(a), ...sbe16(0)]))
  const nameStr = [...'TestFont'].flatMap((c) => be16(c.charCodeAt(0)))
  const name = bytes(be16(0), be16(1), be16(18), be16(3), be16(1), be16(0x409), be16(6), be16(nameStr.length), be16(0), nameStr)
  const post = bytes(be32(0x00030000), be32(0), new Array(24).fill(0))
  const os2 = bytes(be16(0), sbe16(500), be16(400), be16(5), be16(options.fsType ?? 0), new Array(68).fill(0))
  const tables: [string, Uint8Array][] = [['OS/2', os2], ['cmap', cmap], ['glyf', Uint8Array.from(glyf)], ['head', head], ['hhea', hhea], ['hmtx', hmtx], ['loca', Uint8Array.from(loca)], ['maxp', maxp], ['name', name], ['post', post]]
  const pad = (b: Uint8Array) => (b.length % 4 ? Uint8Array.from([...b, ...new Array(4 - (b.length % 4)).fill(0)]) : b)
  const dirLen = 12 + tables.length * 16
  let at = dirLen
  const dir: number[] = [...(options.sfnt ? [...options.sfnt].map((c) => c.charCodeAt(0)) : be32(0x00010000)), ...be16(tables.length), ...be16(128), ...be16(3), ...be16(tables.length * 16 - 128)]
  const body: number[] = []
  for (const [tag, data] of tables) {
    dir.push(...[...tag].map((c) => c.charCodeAt(0)), ...be32(0), ...be32(at), ...be32(data.length))
    const p = pad(data)
    body.push(...p)
    at += p.length
  }
  return Uint8Array.from([...dir, ...body])
}
