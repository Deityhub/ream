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
