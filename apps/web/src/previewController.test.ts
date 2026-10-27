import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UserError, type FileData } from '@ream/core'
import { DEBOUNCE_MS, MANUAL_ABOVE_BYTES, createPreviewController, type Job, type PreviewState, type Update } from './previewController'

const out = (name: string): FileData[] => [{ name, type: 'image/png', bytes: new Uint8Array(1) }]

/** a job we can settle by hand, recording whether it was cancelled */
function fakeJob() {
  let resolve!: (f: FileData[]) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<FileData[]>((res, rej) => ((resolve = res), (reject = rej)))
  const job: Job & { cancelled: boolean } = {
    promise,
    cancelled: false,
    cancel() {
      job.cancelled = true
      reject(new DOMException('Cancelled', 'AbortError'))
    },
  }
  return { job, resolve, reject }
}

function setup() {
  const states: PreviewState[] = []
  const ctl = createPreviewController((s) => states.push(s))
  const jobs: ReturnType<typeof fakeJob>[] = []
  const update = (over: Partial<Update> = {}): Update => ({
    ready: true,
    bytes: 1000,
    start: () => {
      const j = fakeJob()
      jobs.push(j)
      return j.job
    },
    ...over,
  })
  const last = () => states.at(-1)
  return { ctl, jobs, update, states, last }
}
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('preview controller', () => {
  test('nothing to preview yet is idle and starts no job', async () => {
    const { ctl, jobs, update, last } = setup()
    ctl.schedule(update({ ready: false }))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2)
    expect(last()).toEqual({ kind: 'idle' })
    expect(jobs).toHaveLength(0)
  })

  test('rapid changes collapse into one job after the delay', async () => {
    const { ctl, jobs, update, last } = setup()
    for (let i = 0; i < 5; i++) {
      ctl.schedule(update())
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(jobs).toHaveLength(0) // still settling
    expect(last()).toEqual({ kind: 'pending' })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(jobs).toHaveLength(1)
  })

  test('a finished job becomes the ready result', async () => {
    const { ctl, jobs, update, last } = setup()
    ctl.schedule(update())
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    jobs[0].resolve(out('a'))
    await settle()
    expect(last()).toEqual({ kind: 'ready', outputs: out('a'), stale: false, computing: false })
  })

  test('a newer change cancels the running job and its late answer is ignored', async () => {
    const { ctl, jobs, update, last } = setup()
    ctl.schedule(update())
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    ctl.schedule(update()) // user moved a slider
    expect(jobs[0].job.cancelled).toBe(true)
    jobs[0].resolve(out('old')) // arrives too late
    await settle()
    expect(last()).toEqual({ kind: 'pending' })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    jobs[1].resolve(out('new'))
    await settle()
    expect(last()).toEqual({ kind: 'ready', outputs: out('new'), stale: false, computing: false })
  })

  test('the last result stays on screen, outdated but calm, while the user is still changing things', async () => {
    const { ctl, jobs, update, last } = setup()
    ctl.schedule(update())
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    jobs[0].resolve(out('first'))
    await settle()
    // keystrokes every 200 ms: the result is outdated (so Run won't reuse it) but nothing visibly changes, no job starts
    for (let i = 0; i < 4; i++) {
      ctl.schedule(update())
      await vi.advanceTimersByTimeAsync(200)
      expect(last()).toEqual({ kind: 'ready', outputs: out('first'), stale: true, computing: false })
    }
    expect(jobs).toHaveLength(1)
  })

  test('once the user stops, the job starts and only then is the result marked as computing', async () => {
    const { ctl, jobs, update, last } = setup()
    ctl.schedule(update())
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    jobs[0].resolve(out('first'))
    await settle()
    ctl.schedule(update())
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1)
    expect(last()).toEqual({ kind: 'ready', outputs: out('first'), stale: true, computing: false })
    await vi.advanceTimersByTimeAsync(1)
    expect(jobs).toHaveLength(2)
    expect(last()).toEqual({ kind: 'ready', outputs: out('first'), stale: true, computing: true })
    jobs[1].resolve(out('second'))
    await settle()
    expect(last()).toEqual({ kind: 'ready', outputs: out('second'), stale: false, computing: false })
  })

  test('user-facing errors are passed on; others get a generic message', async () => {
    const { ctl, jobs, update, last } = setup()
    ctl.schedule(update())
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    jobs[0].reject(new UserError('Enter a width or a height.'))
    await settle()
    expect(last()).toEqual({ kind: 'error', message: 'Enter a width or a height.' })
    ctl.schedule(update())
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    jobs[1].reject(new Error('boom: internal detail'))
    await settle()
    expect(last()).toEqual({ kind: 'error', message: "Couldn't make a preview for these files." })
  })

  test('large inputs wait for an explicit refresh', async () => {
    const { ctl, jobs, update, last } = setup()
    ctl.schedule(update({ bytes: MANUAL_ABOVE_BYTES + 1 }))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2)
    expect(last()).toEqual({ kind: 'manual' })
    expect(jobs).toHaveLength(0)
    ctl.refresh()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(jobs).toHaveLength(1)
    jobs[0].resolve(out('big'))
    await settle()
    expect(last()).toEqual({ kind: 'ready', outputs: out('big'), stale: false, computing: false })
  })

  test('dispose cancels the job and silences later answers', async () => {
    const { ctl, jobs, update, states } = setup()
    ctl.schedule(update())
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    ctl.dispose()
    expect(jobs[0].job.cancelled).toBe(true)
    const before = states.length
    jobs[0].resolve(out('late'))
    await settle()
    expect(states).toHaveLength(before)
  })

  test('going back to not-ready forgets the old result', async () => {
    const { ctl, jobs, update, last } = setup()
    ctl.schedule(update())
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    jobs[0].resolve(out('a'))
    await settle()
    ctl.schedule(update({ ready: false }))
    expect(last()).toEqual({ kind: 'idle' })
    ctl.schedule(update())
    expect(last()).toEqual({ kind: 'pending' }) // not the stale 'a'
  })
})
