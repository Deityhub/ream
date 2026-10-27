import { expect, test } from 'vitest'
import { tools, findTool } from './index'

test('registry: unique ids, complete manifests', () => {
  const ids = tools.map((t) => t.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const t of tools) {
    expect(t.title && t.description && t.icon).toBeTruthy()
    expect(['pdf', 'image']).toContain(t.category)
    expect(t.accept.length).toBeGreaterThan(0)
    expect(findTool(t.id)).toBe(t)
  }
})

test('every ready tool has a runner and a panel, and no entry is left without a tool', async () => {
  const { runners } = await import('./runners.ts')
  const { panels } = await import('./panels.ts')
  const ready = tools.filter((t) => t.status === 'ready').map((t) => t.id).sort()
  expect(Object.keys(runners).sort()).toEqual(ready)
  expect(Object.keys(panels).sort()).toEqual(ready)
})
