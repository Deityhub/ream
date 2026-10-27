import { beforeAll, expect, test } from 'vitest'
import { createImage, encodePng, ownCodec, setCodec } from '@ream/image-core'
import { decodeFile, keepDecoded } from './image-common.ts'

beforeAll(() => setCodec(ownCodec))

test('a keyed input is decoded once, each caller gets its own copy, and it is forgotten when no longer used', async () => {
  const img = createImage(4, 3)
  img.data.fill(200)
  const f = { name: 'a.png', type: 'image/png', key: '1', bytes: await encodePng(img) }
  const first = await decodeFile(f)
  first.data.fill(0) // a tool drawing on its copy
  // the same key with unreadable bytes: only the kept picture can answer
  const again = await decodeFile({ ...f, bytes: new Uint8Array(8) })
  expect(Array.from(again.data)).toEqual(Array.from(img.data))
  keepDecoded(['2'])
  await expect(decodeFile({ ...f, bytes: new Uint8Array(8) })).rejects.toThrow()
  // no key (tests, outputs): never kept
  await decodeFile({ ...f, key: undefined })
  await expect(decodeFile({ ...f, key: undefined, bytes: new Uint8Array(8) })).rejects.toThrow()
})
