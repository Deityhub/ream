import { PdfDocument } from '@ream/pdf-core'
import type { Ctx2D, Platform } from '../src/platform.ts'
import { assemble } from '../../pdf-core/test/helpers.ts'

export type Call = [string, ...unknown[]]

// Node has no Path2D; the renderer only builds clip paths with it, so a no-op stand-in is enough for call-recording tests
if (!('Path2D' in globalThis)) {
  ;(globalThis as Record<string, unknown>).Path2D = class {
    moveTo() {}
    lineTo() {}
    arc() {}
    closePath() {}
  }
}

/** A canvas context that records every method call and property assignment instead of drawing. */
export function fakeCtx() {
  const calls: Call[] = []
  const gradient = () => ({ addColorStop: (...a: unknown[]) => calls.push(['addColorStop', ...a]) })
  const ctx = new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name === 'createLinearGradient' || name === 'createRadialGradient') {
          return (...a: unknown[]) => (calls.push([name, ...a]), gradient())
        }
        return (...a: unknown[]) => void calls.push([name, ...a])
      },
      set: (_t, name: string, value) => (calls.push(['set', name, value]), true),
    },
  ) as unknown as Ctx2D
  /** every call with this name, as its argument lists */
  const all = (name: string) => calls.filter((c) => c[0] === name).map((c) => c.slice(1))
  /** the value of the last assignment to a property before call number `before` (default: the end) */
  const prop = (name: string, before = calls.length) => {
    for (let i = before - 1; i >= 0; i--) if (calls[i][0] === 'set' && calls[i][1] === name) return calls[i][2]
    return undefined
  }
  return { ctx, calls, all, prop }
}

/** a platform that hands back plain records, so tests can see what would have been drawn */
export function fakePlatform(jpeg?: { width: number; height: number; rgba: Uint8ClampedArray }) {
  const made: { width: number; height: number; rgba: Uint8ClampedArray }[] = []
  const platform: Platform = {
    imageFromRGBA(width, height, rgba) {
      made.push({ width, height, rgba })
      return { fake: made.length - 1 } as unknown as CanvasImageSource
    },
    async decodeJpeg() {
      if (!jpeg) throw new Error('no jpeg in this test')
      return jpeg
    },
  }
  return { platform, made }
}

export const stream = (extra: string, data: string) => `<< ${extra} /Length ${data.length} >>\nstream\n${data}\nendstream`

/** hex text for ASCIIHexDecode, which lets tests write binary pixel data as plain text */
export const hex = (...bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + '>'

/** a one page document: 100 x 100 by default, with the given content stream, resources and extra objects (numbered 10 up) */
export async function onePage(o: { content: string; resources?: string; box?: string; pageExtra?: string; objects?: Record<number, string> }) {
  const objs: [number, string][] = [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, `<< /Type /Page /Parent 2 0 R /MediaBox ${o.box ?? '[0 0 100 100]'} /Resources << ${o.resources ?? ''} >> /Contents 4 0 R ${o.pageExtra ?? ''} >>`],
    [4, stream('', o.content)],
    ...Object.entries(o.objects ?? {}).map(([n, b]): [number, string] => [Number(n), b]),
  ]
  return PdfDocument.load(assemble(objs).bytes)
}
