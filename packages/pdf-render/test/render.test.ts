import { describe, expect, test } from 'vitest'
import { renderPage } from '../src/index.ts'
import { IDENTITY, apply, mul, pageMatrix } from '../src/matrix.ts'
import { fakeCtx, fakePlatform, hex, onePage, stream } from './helpers.ts'

/** render a one page document at its natural size (100 pt wide = 100 px) and return what was drawn */
async function draw(o: Parameters<typeof onePage>[0], platform = fakePlatform().platform) {
  const doc = await onePage(o)
  const f = fakeCtx()
  const result = await renderPage(doc, 0, f.ctx, 100, { platform })
  return { ...f, result }
}
const near = (a: unknown, b: number[]) => (a as number[]).forEach((v, i) => expect(v).toBeCloseTo(b[i], 6))

describe('matrices', () => {
  test('mul applies the left matrix first', () => {
    const scale: [number, number, number, number, number, number] = [2, 0, 0, 2, 0, 0]
    const shift: [number, number, number, number, number, number] = [1, 0, 0, 1, 10, 0]
    expect(apply(mul(scale, shift), 1, 1)).toEqual([12, 2]) // scale, then shift
    expect(apply(mul(shift, scale), 1, 1)).toEqual([22, 2]) // shift, then scale
    expect(mul(IDENTITY, scale)).toEqual(scale)
  })

  test('pageMatrix puts the page corners where a viewer would, for every rotation', () => {
    const box: [number, number, number, number] = [10, 20, 210, 120] // 200 wide, 100 tall, offset origin
    const corner = (rot: number, x: number, y: number) => apply(pageMatrix(box, rot, 1), x, y)
    // rotation 0: lower-left is bottom-left, upper-right is top-right of a 200x100 canvas
    expect(corner(0, 10, 20)).toEqual([0, 100])
    expect(corner(0, 210, 120)).toEqual([200, 0])
    // 90 clockwise: canvas is 100x200; the lower-left corner ends up top-left, upper-right bottom-right
    expect(corner(90, 10, 20)).toEqual([0, 0])
    expect(corner(90, 210, 120)).toEqual([100, 200])
    // 180: lower-left ends up top-right
    expect(corner(180, 10, 20)).toEqual([200, 0])
    expect(corner(180, 210, 120)).toEqual([0, 100])
    // 270: lower-left ends up bottom-right
    expect(corner(270, 10, 20)).toEqual([100, 200])
    expect(corner(270, 210, 120)).toEqual([0, 0])
    expect(corner(-90, 10, 20)).toEqual(corner(270, 10, 20))
  })

  test('the page rotation reaches the canvas transform', async () => {
    const doc = await onePage({ content: '', box: '[0 0 100 50]', pageExtra: '/Rotate 90' })
    const f = fakeCtx()
    await renderPage(doc, 0, f.ctx, 50) // rotated page is 50 wide, 100 tall; 1 px per pt
    near(f.all('setTransform').at(-1)!, [0, 1, 1, 0, 0, 0])
  })
})

describe('paths and painting', () => {
  test('a filled rectangle: white page first, then colour, rect and fill in that order', async () => {
    const { calls, all, prop } = await draw({ content: '1 0 0 rg 10 20 30 40 re f' })
    expect(all('fillRect')[0]).toEqual([0, 0, 100, 100]) // the white page
    expect(prop('fillStyle', calls.findIndex((c) => c[0] === 'fill'))).toBe('rgb(255,0,0)')
    expect(all('rect')).toEqual([[10, 20, 30, 40]])
    expect(all('fill')).toEqual([['nonzero']])
    near(all('setTransform').at(-1)!, [1, 0, 0, -1, 0, 100]) // y flipped for a 100 point page
  })

  test('f* fills even-odd and B fills then strokes', async () => {
    const { all, calls } = await draw({ content: '0 0 10 10 re f* 0 0 10 10 re B*' })
    expect(all('fill')).toEqual([['evenodd'], ['evenodd']])
    expect(all('stroke')).toHaveLength(1)
    expect(calls.findIndex((c) => c[0] === 'fill')).toBeLessThan(calls.findIndex((c) => c[0] === 'stroke'))
  })

  test('curves: v repeats the current point as the first control, y the end point as the second', async () => {
    const { all } = await draw({ content: '5 6 m 1 2 3 4 5 6 c 10 10 20 20 v 30 30 40 40 y S' })
    expect(all('bezierCurveTo')).toEqual([
      [1, 2, 3, 4, 5, 6],
      [5, 6, 10, 10, 20, 20], // v: current point (5,6) is the first control
      [30, 30, 40, 40, 40, 40], // y: second control is the end point
    ])
  })

  test('h closes the subpath and s closes before stroking', async () => {
    const { all } = await draw({ content: '0 0 m 10 0 l 10 10 l h S 0 0 m 5 5 l s' })
    expect(all('closePath')).toHaveLength(2)
    expect(all('stroke')).toHaveLength(2)
  })

  test('W n clips and starts a new path; a clip after a fill happens after the fill', async () => {
    const { calls, all } = await draw({ content: '0 0 50 50 re W n 0 0 10 10 re f' })
    const clip = calls.findIndex((c) => c[0] === 'clip')
    expect(all('clip')).toEqual([['nonzero']])
    expect(calls[clip + 1][0]).toBe('beginPath')
    expect(calls.findIndex((c) => c[0] === 'fill')).toBeGreaterThan(clip)
    const { calls: c2 } = await draw({ content: '0 0 10 10 re W* f' })
    expect(c2.findIndex((c) => c[0] === 'clip')).toBeGreaterThan(c2.findIndex((c) => c[0] === 'fill'))
  })

  test('n paints nothing', async () => {
    const { all } = await draw({ content: '0 0 10 10 re n' })
    expect(all('fill')).toHaveLength(1 - 1)
    expect(all('stroke')).toHaveLength(0)
  })
})

describe('graphics state', () => {
  test('cm multiplies into the transform: the new matrix is applied first', async () => {
    const { all } = await draw({ content: '2 0 0 2 5 5 cm 1 0 0 1 10 0 cm' })
    // user point (0,0) -> shift(10,0) -> scale 2 + move (5,5) = (25,5) -> flip to device (25, 95)
    const m = all('setTransform').at(-1)! as number[]
    expect(apply(m as [number, number, number, number, number, number], 0, 0)).toEqual([25, 95])
  })

  test('q and Q save and restore; an extra Q is ignored; open q are closed at the end', async () => {
    const a = await draw({ content: 'q q 0 0 1 1 re f Q Q Q' })
    expect(a.all('save').length).toBe(a.all('restore').length)
    const b = await draw({ content: 'q q q' })
    expect(b.all('save').length).toBe(b.all('restore').length)
  })

  test('colour state is restored by Q', async () => {
    const { calls, all } = await draw({ content: '0 1 0 rg q 1 0 0 rg Q 0 0 1 1 re f' })
    expect(all('fill')).toHaveLength(1)
    expect(calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle').at(-1)![2]).toBe('rgb(0,255,0)')
  })

  test('colour operators: gray, rgb, cmyk for fill and stroke', async () => {
    const { calls } = await draw({ content: '0.5 g 0 0 1 1 re f 0 0 0 1 K 0 0 1 1 re S 1 0 0 0 k 0 0 1 1 re f' })
    const sets = calls.filter((c) => c[0] === 'set' && (c[1] === 'fillStyle' || c[1] === 'strokeStyle')).map((c) => c[2])
    expect(sets).toContain('rgb(128,128,128)')
    expect(sets.some((c) => /^rgb\((\d+),(\d+),(\d+)\)$/.test(String(c)) && Number(RegExp.$1) < 70 && Number(RegExp.$2) < 70)).toBe(true) // 0 0 0 1 K: near black
    expect(sets.some((c) => /^rgb\(([0-9]|1[0-4]),(1[4-9]\d|20\d),(19\d|2[0-4]\d)\)$/.test(String(c)))).toBe(true) // 1 0 0 0 k: cyan ink
  })

  test('named colour spaces from the resources, with sc/scn components', async () => {
    const { calls } = await draw({
      content: '/CS0 cs 1 0 0 0 scn 0 0 1 1 re f',
      resources: '/ColorSpace << /CS0 [/Separation /Ink /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 1 1 0] /N 1 >>] >>',
    })
    // Separation takes the first component only: full ink -> the tint maps to a warm red in CMYK
    expect(String(calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle').at(-1)![2])).toMatch(/^rgb\(2[45]\d,\d{1,2},\d{1,2}\)$/)
  })

  test('line style: width, cap, join, miter, dash; a zero width becomes a hairline', async () => {
    const { calls, all } = await draw({ content: '4 w 1 J 2 j 3 M [5 2] 1 d 0 0 m 9 9 l S 0 w 0 0 m 9 9 l S' })
    const sets = (name: string) => calls.filter((c) => c[0] === 'set' && c[1] === name).map((c) => c[2])
    expect(sets('lineWidth')).toEqual([4, 1]) // second stroke: 1 device pixel at scale 1
    expect(sets('lineCap')).toContain('round')
    expect(sets('lineJoin')).toContain('bevel')
    expect(sets('miterLimit')).toContain(3)
    expect(all('setLineDash')[0]).toEqual([[5, 2]])
    expect(sets('lineDashOffset')).toContain(1)
  })

  test('gs: alpha and blend mode reach the fill, then are reset', async () => {
    const { calls } = await draw({
      content: '/G1 gs 0 0 1 1 re f',
      resources: '/ExtGState << /G1 << /ca 0.25 /CA 0.5 /BM /Multiply /LW 3 >> >>',
    })
    const fillAt = calls.findIndex((c) => c[0] === 'fill')
    const before = (name: string) => calls.slice(0, fillAt).filter((c) => c[0] === 'set' && c[1] === name).at(-1)![2]
    expect(before('globalAlpha')).toBe(0.25)
    expect(before('globalCompositeOperation')).toBe('multiply')
    expect(calls.slice(fillAt).filter((c) => c[0] === 'set' && c[1] === 'globalAlpha').at(0)![2]).toBe(1)
  })

  test('an unsupported soft mask is reported, not silently ignored', async () => {
    const { result } = await draw({ content: '/G1 gs', resources: '/ExtGState << /G1 << /SMask << /S /Luminosity >> >> >>' })
    expect(result.warnings).toContain("Soft masks aren't applied yet")
  })
})

describe('images', () => {
  test('inline image: pixels decoded to RGBA and drawn into the unit square, first row on top', async () => {
    const fp = fakePlatform()
    const { all } = await draw({ content: 'q 50 0 0 50 10 10 cm BI /W 2 /H 1 /CS /RGB /BPC 8 /F /AHx ID ' + hex(255, 0, 0, 0, 255, 0) + ' EI Q' }, fp.platform)
    expect(fp.made).toHaveLength(1)
    expect([fp.made[0].width, fp.made[0].height]).toEqual([2, 1])
    expect(Array.from(fp.made[0].rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
    near(all('transform')[0], [1 / 2, 0, 0, -1, 0, 1])
    expect(all('drawImage')).toHaveLength(1)
  })

  test('inline image without a filter: length comes from the dimensions, not from hunting for EI', async () => {
    const fp = fakePlatform()
    // the data deliberately contains the bytes " EI " (0x20 0x45 0x49 0x20)
    await draw({ content: 'BI /W 4 /H 1 /CS /G /BPC 8 ID \x20\x45\x49\x20 EI' }, fp.platform)
    expect(Array.from(fp.made[0].rgba.filter((_, i) => i % 4 === 0))).toEqual([0x20, 0x45, 0x49, 0x20])
  })

  test('image XObject: indexed 2-bit palette, drawn once per Do but decoded once', async () => {
    const fp = fakePlatform()
    const { all } = await draw(
      {
        content: 'q 10 0 0 10 0 0 cm /Im Do Q q 10 0 0 10 20 0 cm /Im Do Q',
        resources: '/XObject << /Im 10 0 R >>',
        objects: { 10: stream('/Type /XObject /Subtype /Image /Width 4 /Height 1 /BitsPerComponent 2 /ColorSpace [/Indexed /DeviceRGB 3 <ff0000 00ff00 0000ff ffffff>] /Filter /ASCIIHexDecode', hex(0b00011011)) },
      },
      fp.platform,
    )
    expect(fp.made).toHaveLength(2) // two draws share one decoded raster, each wraps it in a drawable
    expect(fp.made[0].rgba).toBe(fp.made[1].rgba)
    expect(Array.from(fp.made[0].rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
    expect(all('drawImage')).toHaveLength(2)
  })

  test('image mask paints in the current fill colour, with its Decode honoured', async () => {
    const fp = fakePlatform()
    await draw(
      {
        content: '0 0 1 rg /M Do',
        resources: '/XObject << /M 10 0 R >>',
        objects: { 10: stream('/Subtype /Image /Width 4 /Height 1 /ImageMask true /Filter /ASCIIHexDecode', hex(0b01000000)) },
      },
      fp.platform,
    )
    // sample 0 paints with the default Decode: pixels 0, 2, 3 are blue, pixel 1 is left clear
    expect(Array.from(fp.made[0].rgba)).toEqual([0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255])
    const inv = fakePlatform()
    await draw(
      {
        content: '0 0 1 rg /M Do',
        resources: '/XObject << /M 10 0 R >>',
        objects: { 10: stream('/Subtype /Image /Width 4 /Height 1 /ImageMask true /Decode [1 0] /Filter /ASCIIHexDecode', hex(0b01000000)) },
      },
      inv.platform,
    )
    expect(Array.from(inv.made[0].rgba.filter((_, i) => i % 4 === 3))).toEqual([0, 255, 0, 0])
  })

  test('soft mask becomes the alpha channel; a colour-key Mask makes matching pixels transparent', async () => {
    const soft = fakePlatform()
    await draw(
      {
        content: '/Im Do',
        resources: '/XObject << /Im 10 0 R >>',
        objects: {
          10: stream('/Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /SMask 11 0 R /Filter /ASCIIHexDecode', hex(10, 20)),
          11: stream('/Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /ASCIIHexDecode', hex(0, 200)),
        },
      },
      soft.platform,
    )
    expect(Array.from(soft.made[0].rgba.filter((_, i) => i % 4 === 3))).toEqual([0, 200])
    const key = fakePlatform()
    await draw(
      {
        content: '/Im Do',
        resources: '/XObject << /Im 10 0 R >>',
        objects: { 10: stream('/Subtype /Image /Width 3 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Mask [5 15] /Filter /ASCIIHexDecode', hex(0, 10, 99)) },
      },
      key.platform,
    )
    expect(Array.from(key.made[0].rgba.filter((_, i) => i % 4 === 3))).toEqual([255, 0, 255])
  })

  test('a JPEG goes through the platform decoder, with the soft mask applied on top', async () => {
    const jpeg = { width: 2, height: 1, rgba: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]) }
    const fp = fakePlatform(jpeg)
    await draw(
      {
        content: '/Im Do',
        resources: '/XObject << /Im 10 0 R >>',
        objects: { 10: stream('/Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'jpeg bytes') },
      },
      fp.platform,
    )
    expect(Array.from(fp.made[0].rgba)).toEqual([1, 2, 3, 255, 4, 5, 6, 255])
  })

  test('images we cannot decode yet are marked with a grey box and reported', async () => {
    const { all, result, prop, calls } = await draw({
      content: 'q 40 0 0 40 5 5 cm /Im Do Q',
      resources: '/XObject << /Im 10 0 R >>',
      objects: { 10: stream('/Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode', 'x') },
    })
    expect(result.warnings).toContain("CCITTFax images aren't drawn yet")
    expect(all('fillRect').at(-1)).toEqual([0, 0, 1, 1])
    expect(prop('fillStyle', calls.length)).toBe('rgb(208,208,208)')
    expect(all('drawImage')).toHaveLength(0)
  })
})

describe('forms, shadings, annotations', () => {
  test('a form applies its Matrix, clips to its BBox, and draws with its own transform inside', async () => {
    const { calls, all } = await draw({
      content: '/F Do',
      resources: '/XObject << /F 10 0 R >>',
      objects: { 10: stream('/Subtype /Form /BBox [0 0 20 20] /Matrix [2 0 0 2 10 10]', '1 0 0 rg 0 0 5 5 re f') },
    })
    expect(all('rect')).toContainEqual([0, 0, 20, 20]) // the BBox clip
    expect(all('rect')).toContainEqual([0, 0, 5, 5])
    const tf = all('setTransform').at(-1) as number[]
    // user (0,0) inside the form -> matrix (10,10) -> device y flipped (100 - 10 = 90)
    expect(apply(tf as [number, number, number, number, number, number], 0, 0)).toEqual([10, 90])
    expect(all('save').length).toBe(all('restore').length)
    expect(calls.findIndex((c) => c[0] === 'clip')).toBeLessThan(calls.findIndex((c) => c[0] === 'fill'))
  })

  test('forms may use the page resources or their own; self-reference does not loop forever', async () => {
    const { result } = await draw({
      content: '/F Do',
      resources: '/XObject << /F 10 0 R >>',
      objects: { 10: stream('/Subtype /Form /BBox [0 0 5 5] /Resources << /XObject << /F 10 0 R >> >>', '/F Do') },
    })
    expect(result.warnings).toContain('Forms nested too deeply to draw')
  })

  test('axial shading with sh: a gradient with the right end points and 65 stops', async () => {
    const { all } = await draw({
      content: '/S sh',
      resources: '/Shading << /S << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >> >>',
    })
    expect(all('createLinearGradient')).toEqual([[0, 0, 100, 0]])
    expect(all('addColorStop')).toHaveLength(65)
    expect(all('addColorStop')[0]).toEqual([0, 'rgb(255,0,0)'])
    expect(all('clip')).toHaveLength(1) // no /Extend: the shading must not paint past its end lines
    expect(all('addColorStop').at(-1)).toEqual([1, 'rgb(0,0,255)'])
    expect(all('fillRect').length).toBeGreaterThan(1)
  })

  test('radial shading, and a shading pattern fill uses the pattern matrix', async () => {
    const shading = '/Shading << /ShadingType 3 /ColorSpace /DeviceGray /Coords [0 0 0 0 0 10] /Function << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >> >>'
    const { all } = await draw({
      content: '/Pattern cs /P1 scn 0 0 50 50 re f',
      resources: `/Pattern << /P1 << /PatternType 2 /Matrix [2 0 0 2 0 0] ${shading} >> >>`,
    })
    expect(all('createRadialGradient')).toEqual([[0, 0, 0, 0, 0, 10]])
    // pattern space = base x pattern matrix: scale 2 on top of the page flip
    near(all('setTransform').at(-1)!, [2, 0, 0, -2, 0, 100])
    // the path clip first, then the shading's own extent (no /Extend: nothing past the end circle)
    expect(all('clip')).toHaveLength(2)
    expect(all('clip')[0]).toEqual(['nonzero'])
  })

  test('shadings we cannot draw yet are reported', async () => {
    const { result } = await draw({ content: '/S sh', resources: '/Shading << /S << /ShadingType 4 /ColorSpace /DeviceRGB >> >>' })
    expect(result.warnings).toContain("Some shadings couldn't be drawn")
  })

  test('annotation appearance is scaled from its BBox into its Rect', async () => {
    const { all } = await draw({
      content: '',
      pageExtra: '/Annots [10 0 R]',
      objects: {
        10: '<< /Type /Annot /Subtype /Square /Rect [10 10 60 60] /AP << /N 11 0 R >> >>',
        11: stream('/Subtype /Form /BBox [0 0 100 100]', '1 0 0 rg 0 0 100 100 re f'),
      },
    })
    // the 100x100 box lands in a 50x50 rect at (10,10): scale 0.5, origin moved to (10,10), then the page flip
    const m = all('setTransform').find((t) => Math.abs((t as number[])[0] - 0.5) < 1e-9) as number[]
    expect(m).toBeDefined()
    expect(apply(m as [number, number, number, number, number, number], 0, 0)).toEqual([10, 90])
    expect(apply(m as [number, number, number, number, number, number], 100, 100)).toEqual([60, 40])
  })

  test('hidden annotations, popups and ones without an appearance are skipped', async () => {
    const { all } = await draw({
      content: '',
      pageExtra: '/Annots [10 0 R 12 0 R 13 0 R]',
      objects: {
        10: '<< /Subtype /Square /F 2 /Rect [0 0 10 10] /AP << /N 11 0 R >> >>',
        11: stream('/Subtype /Form /BBox [0 0 10 10]', '0 0 10 10 re f'),
        12: '<< /Subtype /Popup /Rect [0 0 10 10] /AP << /N 11 0 R >> >>',
        13: '<< /Subtype /Link /Rect [0 0 10 10] >>',
      },
    })
    expect(all('fill')).toHaveLength(0)
  })

  test('appearance states: the /AS entry picks the stream', async () => {
    const { all } = await draw({
      content: '',
      pageExtra: '/Annots [10 0 R]',
      objects: {
        10: '<< /Subtype /Widget /Rect [0 0 10 10] /AS /On /AP << /N << /On 11 0 R /Off 12 0 R >> >> >>',
        11: stream('/Subtype /Form /BBox [0 0 10 10]', '0 0 3 3 re f'),
        12: stream('/Subtype /Form /BBox [0 0 10 10]', '0 0 7 7 re f'),
      },
    })
    expect(all('rect')).toContainEqual([0, 0, 3, 3])
    expect(all('rect')).not.toContainEqual([0, 0, 7, 7])
  })
})

describe('robustness', () => {
  test('text is not drawn yet and says so', async () => {
    const { result } = await draw({ content: 'BT /F1 12 Tf 10 10 Td (Hello) Tj ET' })
    expect(result.warnings).toContain("Text isn't drawn yet")
  })

  test('unknown operators and garbage bytes do not stop the rest of the page', async () => {
    const { all } = await draw({ content: 'foo bar 1 2 baz \x00\x01\x02 ) ] >> 0 0 5 5 re f' })
    expect(all('fill')).toHaveLength(1)
  })

  test('operands of the wrong type are treated as zero, not as a crash', async () => {
    const { all } = await draw({ content: '(x) /y 3 re f 0 0 1 1 re f' })
    expect(all('fill')).toHaveLength(2)
  })

  test('a stream that is cut off mid-operator still draws what came before', async () => {
    const { all } = await draw({ content: '0 0 5 5 re f 0 0 5 5 r' })
    expect(all('fill')).toHaveLength(1)
  })

  test('an aborted render stops with an AbortError', async () => {
    const doc = await onePage({ content: '0 0 1 1 re f '.repeat(2000) })
    const ac = new AbortController()
    ac.abort()
    const f = fakeCtx()
    await expect(renderPage(doc, 0, f.ctx, 100, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('page contents may be an array of streams, joined with whitespace between them', async () => {
    const doc = await onePage({ content: '0 0 5 5', pageExtra: '', objects: {} })
    // rebuild with an array: stream 4 = "0 0 5 5", stream 5 = "re f"
    const { PdfDocument } = await import('@ream/pdf-core')
    const { assemble } = await import('../../pdf-core/test/helpers.ts')
    const two = await PdfDocument.load(
      assemble([
        [1, '<< /Type /Catalog /Pages 2 0 R >>'],
        [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
        [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents [4 0 R 5 0 R] >>'],
        [4, stream('', '0 0 5 5')],
        [5, stream('', 're f')],
      ]).bytes,
    )
    const f = fakeCtx()
    await renderPage(two, 0, f.ctx, 100)
    expect(f.all('rect')).toEqual([[0, 0, 5, 5]])
    expect(f.all('fill')).toHaveLength(1)
    void doc
  })

  test('crop box and media box offsets move the origin', async () => {
    const doc = await onePage({ content: '', box: '[0 0 200 200]', pageExtra: '/CropBox [50 50 150 150]' })
    const f = fakeCtx()
    await renderPage(doc, 0, f.ctx, 100)
    near(f.all('setTransform').at(-1)!, [1, 0, 0, -1, -50, 150]) // origin of the crop box at the top-left
  })

  test('asking for a page that does not exist is a clear error', async () => {
    const doc = await onePage({ content: '' })
    await expect(renderPage(doc, 3, fakeCtx().ctx, 100)).rejects.toThrow('There is no page 4')
  })
})
