import { describe, expect, test } from 'vitest'
import { renderWidthFor, zoomedWidth } from '../src/Zoom.tsx'

describe('zoom', () => {
  const a4 = { width: 595, height: 842 }
  test('a factor of the actual size (a point is 4/3 pixels), the width there is room for, or the whole page in view', () => {
    expect(zoomedWidth(1, a4, { width: 500, height: 600 })).toBeCloseTo(793.33)
    expect(zoomedWidth(0.5, a4, { width: 500, height: 600 })).toBeCloseTo(396.67)
    expect(zoomedWidth('width', a4, { width: 500, height: 600 })).toBe(500)
    // a tall page fitted whole is as wide as its height allows
    expect(zoomedWidth('page', a4, { width: 500, height: 600 })).toBeCloseTo((600 * 595) / 842)
    expect(zoomedWidth('page', a4, { width: 300, height: 600 })).toBe(300)
  })

  test('pages are rendered sharp for the screen, in steps, within limits', () => {
    expect(renderWidthFor(390)).toBe(400)
    expect(renderWidthFor(401)).toBe(600)
    expect(renderWidthFor(10_000)).toBe(4000)
    expect(renderWidthFor(10)).toBe(400)
  })
})
