// Compare our PDF renderer with macOS's own (CoreGraphics, via `sips`) on a corpus of feature PDFs and the real fixtures.
//   node scripts/render-compare.ts [outdir]
// For each PDF it writes <name>.sheet.png: ours | reference | difference, and prints how many pixels differ noticeably.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assemble } from '../packages/pdf-core/test/helpers.ts'
import { createImage, encodePng } from '../packages/image-core/src/index.ts'

const root = resolve(import.meta.dirname, '..')
const out = resolve(process.argv[2] ?? join(root, '.render-compare'))
mkdirSync(out, { recursive: true })

const stream = (extra: string, data: string) => `<< ${extra} /Length ${data.length} >>\nstream\n${data}\nendstream`
const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + '>'
const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('')

type Case = { content: string; resources?: string; box?: string; pageExtra?: string; objects?: Record<number, string> }

function pdf(c: Case): Uint8Array {
  return assemble([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, `<< /Type /Page /Parent 2 0 R /MediaBox ${c.box ?? '[0 0 200 200]'} /Resources << ${c.resources ?? ''} >> /Contents 4 0 R ${c.pageExtra ?? ''} >>`],
    [4, stream('', c.content)],
    ...Object.entries(c.objects ?? {}).map(([n, b]): [number, string] => [Number(n), b]),
  ]).bytes
}

// ---------- test images ----------
const gradient = (w: number, h: number) => {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set([Math.round((x / (w - 1)) * 255), Math.round((y / (h - 1)) * 255), 160, 255], (y * w + x) * 4)
  return img
}
const rgbBytes = (w: number, h: number) => {
  const g = gradient(w, h)
  const bytes: number[] = []
  for (let i = 0; i < w * h; i++) bytes.push(g.data[i * 4], g.data[i * 4 + 1], g.data[i * 4 + 2])
  return bytes
}
async function jpegOfGradient(): Promise<string> {
  const png = join(out, '_grad.png')
  const jpg = join(out, '_grad.jpg')
  writeFileSync(png, await encodePng(gradient(120, 120)))
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', png, '--out', jpg], { stdio: 'ignore' })
  return latin1(new Uint8Array(readFileSync(jpg)))
}

const cases: Record<string, Case> = {
  shapes: {
    content: `
1 0 0 rg 10 150 40 40 re f  0 0.6 0 rg 60 150 40 40 re f  0 0 1 rg 110 150 40 40 re f  0.5 g 160 150 30 40 re f
1 0 0 0 k 10 100 40 40 re f  0 1 0 0 k 60 100 40 40 re f  0 0 1 0 k 110 100 40 40 re f  0 0 0 1 k 160 100 30 40 re f
0 0 0 RG 1 w 10 92 m 190 92 l S  4 w 1 J 10 84 m 190 84 l S  8 w 2 J 10 74 m 190 74 l S
0 J 8 w 0 j 20 35 m 40 65 l 60 35 l S  1 j 80 35 m 100 65 l 120 35 l S  2 j 140 35 m 160 65 l 180 35 l S
0 j 2 w [6 3] 0 d 10 22 m 190 22 l S  [2 2] 1 d 10 15 m 190 15 l S  [] 0 d
0.8 0 0.8 RG 1.5 w 10 3 m 50 20 90 -14 130 3 c S  140 3 m 150 20 170 20 190 3 v S`,
  },
  starFill: {
    content: `
0.1 0.3 0.8 rg  100 190 m 130 100 l 50 160 l 150 160 l 70 100 l h  f*
0.8 0.2 0.1 rg  q 1 0 0 1 0 -95 cm 100 190 m 130 100 l 50 160 l 150 160 l 70 100 l h f Q
0 g 1 w 20 20 160 60 re S 40 30 120 40 re S`,
  },
  clip: {
    content: `
q 100 170 m 138.6 170 170 138.6 170 100 c 170 61.4 138.6 30 100 30 c 61.4 30 30 61.4 30 100 c 30 138.6 61.4 170 100 170 c h W n
1 0 0 rg 0 0 200 70 re f  1 0.8 0 rg 0 70 200 60 re f  0 0.5 1 rg 0 130 200 70 re f
0 g 3 w 0 0 m 200 200 l S 0 200 m 200 0 l S Q
0.3 G 2 w 100 170 m 138.6 170 170 138.6 170 100 c 170 61.4 138.6 30 100 30 c 61.4 30 30 61.4 30 100 c 30 138.6 61.4 170 100 170 c h S`,
  },
  alpha: {
    content: `
1 0 0 rg 20 80 80 80 re f
q /G1 gs 0 0 1 rg 60 40 80 80 re f Q
q /G2 gs 0 0.7 0 rg 100 100 80 80 re f Q
q /G3 gs 1 1 0 rg 20 10 80 40 re f 0 1 1 rg 60 10 80 40 re f Q`,
    resources: '/ExtGState << /G1 << /ca 0.5 >> /G2 << /ca 0.3 /CA 0.3 >> /G3 << /BM /Multiply >> >>',
  },
  shading: {
    content: `
q 10 110 180 80 re W n /S1 sh Q
q 40 10 m 160 10 l 160 90 l 40 90 l h W n /S2 sh Q
/Pattern cs /P1 scn 20 20 m 180 20 l 100 100 l f`,
    resources: `/Shading <<
 /S1 << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [10 0 190 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >>
 /S2 << /ShadingType 3 /ColorSpace /DeviceRGB /Coords [100 50 0 100 50 45] /Function << /FunctionType 3 /Domain [0 1] /Bounds [0.5] /Encode [0 1 0 1]
        /Functions [<< /FunctionType 2 /Domain [0 1] /C0 [1 1 0] /C1 [0 0.6 0] /N 1 >> << /FunctionType 2 /Domain [0 1] /C0 [0 0.6 0] /C1 [0 0 0.4] /N 1 >>] >> >> >>
 /Pattern << /P1 << /PatternType 2 /Shading << /ShadingType 2 /ColorSpace /DeviceGray /Coords [20 0 180 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >> >> >> >>`,
  },
  images: {
    content: `
q 80 0 0 80 10 110 cm /Rgb Do Q
q 0 0 1 rg 80 0 0 80 110 110 cm /Mask Do Q
q 80 0 0 80 10 10 cm /Pal Do Q
q 80 0 0 80 110 10 cm /Soft Do Q`,
    resources: '/XObject << /Rgb 10 0 R /Mask 11 0 R /Pal 12 0 R /Soft 13 0 R >>',
    objects: {
      10: stream('/Type /XObject /Subtype /Image /Width 160 /Height 160 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /ASCIIHexDecode', hex(rgbBytes(160, 160))),
      11: stream('/Type /XObject /Subtype /Image /Width 8 /Height 8 /ImageMask true /Filter /ASCIIHexDecode', hex([0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55])),
      12: stream('/Type /XObject /Subtype /Image /Width 80 /Height 80 /BitsPerComponent 2 /ColorSpace [/Indexed /DeviceRGB 3 <ff0000 00a000 0000ff ffd000>] /Filter /ASCIIHexDecode',
        hex(Array.from({ length: 80 * 20 }, (_, i) => { const x = (i % 20) * 4, y = Math.floor(i / 20); const px = (k: number) => ((x + k + y) >> 3) & 3; return (px(0) << 6) | (px(1) << 4) | (px(2) << 2) | px(3) }))),
      13: stream('/Type /XObject /Subtype /Image /Width 40 /Height 40 /BitsPerComponent 8 /ColorSpace /DeviceRGB /SMask 14 0 R /Filter /ASCIIHexDecode', hex(rgbBytes(40, 40))),
      14: stream('/Type /XObject /Subtype /Image /Width 40 /Height 40 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /ASCIIHexDecode', hex(Array.from({ length: 1600 }, (_, i) => Math.round(255 * Math.min(1, Math.hypot((i % 40) - 20, Math.floor(i / 40) - 20) < 18 ? 1 : 0.25))))),
    },
  },
  form: {
    content: `
0.9 g 0 0 200 200 re f
q 1 0 0 1 20 20 cm /F1 Do Q
q 0.866 0.5 -0.5 0.866 120 30 cm /F1 Do Q`,
    resources: '/XObject << /F1 10 0 R >>',
    objects: {
      10: stream('/Type /XObject /Subtype /Form /BBox [0 0 60 60] /Resources << /XObject << /F2 11 0 R >> >>',
        '1 0 0 rg -10 -10 50 50 re f  0 0 1 rg 30 30 50 50 re f  q 0.5 0 0 0.5 10 10 cm /F2 Do Q'),
      11: stream('/Type /XObject /Subtype /Form /BBox [0 0 40 40] /Matrix [1 0 0 1 0 0]', '0 0.7 0 rg 0 0 40 40 re f 1 1 1 rg 10 10 20 20 re f'),
    },
  },
  annotation: {
    content: '0.95 g 0 0 200 200 re f 0 0 1 RG 3 w 20 20 160 40 re S',
    pageExtra: '/Annots [10 0 R 12 0 R]',
    objects: {
      10: '<< /Type /Annot /Subtype /Square /Rect [30 90 130 170] /AP << /N 11 0 R >> >>',
      11: stream('/Type /XObject /Subtype /Form /BBox [0 0 100 80]', '1 0.9 0 rg 0 0 100 80 re f 0.8 0 0 RG 4 w 2 2 96 76 re S'),
      12: '<< /Type /Annot /Subtype /Square /Rect [140 100 190 150] /F 2 /AP << /N 11 0 R >> >>', // hidden: not drawn
    },
  },
  text: {
    content: `
BT /F1 18 Tf 10 180 Td (Helvetica 18pt) Tj ET
BT /F2 14 Tf 10 160 Td (Bold: The quick brown fox) Tj ET
BT /F3 14 Tf 10 142 Td (Times Roman jumps over) Tj ET
BT /F4 14 Tf 10 125 Td (Times Italic the lazy dog) Tj ET
BT /F5 12 Tf 10 108 Td (Courier 0123456789) Tj ET
BT /F6 12 Tf 10 94 Td (Courier Bold) Tj ET
BT /F1 10 Tf 10 78 Td 3 Tc (Char spacing) Tj 0 Tc ET
BT /F1 10 Tf 10 66 Td 8 Tw (Word spacing here ok) Tj 0 Tw ET
BT /F1 10 Tf 10 54 Td 60 Tz (Horizontal scale 60) Tj 100 Tz ET
BT /F1 10 Tf 10 42 Td [(K) 120 (e) -80 (rn) 60 (ing)] TJ ET
BT /F1 10 Tf 10 30 Td (Rise ) Tj 4 Ts (up) Tj -4 Ts (down) Tj 0 Ts ET
1 0 0 rg BT /F2 12 Tf 110 30 Td (Red text) Tj ET
0 0 1 RG 0.5 w BT /F2 22 Tf 1 Tr 100 6 Td (Outline) Tj ET
0 g BT /F1 12 Tf 0.866 0.5 -0.5 0.866 150 90 Tm (Rotated 30) Tj ET
BT /F1 11 Tf 10 14 Td (Caf\\351 na\\357ve \\200 \\223quotes\\224) Tj ET`,
    resources: `/Font <<
 /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>
 /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>
 /F3 << /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>
 /F4 << /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>
 /F5 << /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>
 /F6 << /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >> >>`,
  },
  cropOffset: {
    content: '0.9 0.9 1 rg 0 0 300 300 re f 1 0 0 rg 100 100 50 50 re f 0 g 2 w 80 80 90 90 re S',
    box: '[0 0 300 300]',
    pageExtra: '/CropBox [60 60 190 190]',
  },
}

async function main() {
  const items: { name: string; pdf: string; ref: string; out: string }[] = []
  const add = (name: string, bytes: Uint8Array) => {
    const p = join(out, `${name}.pdf`)
    writeFileSync(p, bytes)
    const ref = join(out, `${name}.ref.png`)
    const r = spawnSync('sips', ['-s', 'format', 'png', p, '--out', ref], { stdio: 'ignore' })
    if (r.status === 0) items.push({ name, pdf: p, ref, out: join(out, `${name}.sheet.png`) })
    else console.log(`(sips could not render ${name}; skipped)`)
  }
  for (const [name, c] of Object.entries(cases)) add(name, pdf(c))
  add('jpeg', pdf({
    content: 'q 160 0 0 160 20 20 cm /J Do Q 0 g 2 w 20 20 160 160 re S',
    resources: '/XObject << /J 10 0 R >>',
    objects: { 10: stream('/Type /XObject /Subtype /Image /Width 120 /Height 120 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode', await jpegOfGradient()) },
  }) as unknown as Uint8Array)
  for (const f of ['cups.pdf', 'chromium.pdf']) add(`fixture-${f.replace('.pdf', '')}`, new Uint8Array(readFileSync(join(root, 'packages/pdf-core/test/fixtures', f))))

  // bundle the harness for the Electron page
  const bundle = join(out, 'harness.js')
  execFileSync(join(root, 'node_modules/.bin/esbuild'), [join(root, 'scripts/render-harness.ts'), '--bundle', '--format=iife', '--platform=browser', `--outfile=${bundle}`, '--log-level=error'], { cwd: root })
  const job = join(out, 'job.json')
  writeFileSync(job, JSON.stringify({ bundle, items }))
  const r = spawnSync(join(root, 'node_modules/.bin/electron'), [join(root, 'scripts/render-compare.cjs'), job], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const line = r.stdout.split('\n').find((l) => l.startsWith('RESULTS '))
  if (!line) throw new Error('Electron produced no results:\n' + r.stdout.slice(-2000) + r.stderr.slice(-2000))
  const results = JSON.parse(line.slice(8)) as Record<string, any>[]
  console.log('name'.padEnd(22) + 'size'.padEnd(11) + 'differ %'.padEnd(10) + 'mean'.padEnd(7) + 'ms'.padEnd(6) + 'warnings')
  for (const x of results) {
    if (x.error) console.log(x.name.padEnd(22) + 'ERROR ' + x.error)
    else console.log(x.name.padEnd(22) + `${x.width}x${x.height}`.padEnd(11) + String(x.badPercent).padEnd(10) + String(x.meanDiff).padEnd(7) + String(x.ms).padEnd(6) + x.warnings.join('; '))
  }
  console.log(`\nsheets (ours | reference | difference) are in ${out}`)

  // Regression guard: the most pixels that may differ noticeably from CoreGraphics, with a little headroom over today's
  // numbers. Not checked: `annotation` and `cropOffset` (sips draws those wrongly; ours matches Chromium's engine). The
  // remaining `shapes` gap is CMYK (macOS and our fit use different print profiles); text and the fixtures differ only in
  // letter shapes, since embedded fonts are drawn with similar system fonts.
  const limits: Record<string, number> = { shapes: 5.5, starFill: 1, clip: 1, alpha: 2, shading: 1, images: 1.5, form: 1, jpeg: 1, text: 8, 'fixture-cups': 4, 'fixture-chromium': 3 }
  const over = results.filter((x) => limits[x.name] !== undefined && (x.error || x.badPercent > limits[x.name]))
  for (const x of over) console.error(`FAIL ${x.name}: ${x.error ?? `${x.badPercent}% differ, limit ${limits[x.name]}%`}`)
  if (over.length) process.exitCode = 1
}

await main()
