import { UserError, type FileData } from '@ream/core'

export type PreviewState =
  | { kind: 'idle' } // nothing to preview yet (too few files, or previews are off)
  | { kind: 'pending' } // waiting for the debounce or computing, nothing to show yet
  | { kind: 'manual' } // inputs are large: waiting for the user to ask
  | { kind: 'ready'; outputs: FileData[]; stale: boolean } // stale: a newer one is on its way
  | { kind: 'error'; message: string }

export type Job = { promise: Promise<FileData[]>; cancel: () => void }
export type Update = { ready: boolean; bytes: number; start: () => Job }

export const DEBOUNCE_MS = 300
export const MANUAL_ABOVE_BYTES = 25 * 1024 ** 2

const GENERIC = "Couldn't make a preview for these files."

/**
 * Keeps a live preview in step with changing inputs: waits for changes to settle, starts one job, cancels it
 * when something newer arrives, ignores late answers, and keeps showing the last good result (marked stale)
 * while the next one is computed. Plain functions, no React, so the timing rules are unit tested.
 */
export function createPreviewController(onState: (s: PreviewState) => void, delay = DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let job: Job | null = null
  let last: FileData[] | null = null
  let seq = 0
  let current: Update | null = null
  let force = false

  function schedule(update: Update) {
    current = update
    clearTimeout(timer)
    job?.cancel()
    job = null
    const mine = ++seq

    if (!update.ready) {
      last = null
      onState({ kind: 'idle' })
      return
    }
    if (update.bytes > MANUAL_ABOVE_BYTES && !force) {
      onState(last ? { kind: 'ready', outputs: last, stale: true } : { kind: 'manual' })
      return
    }
    force = false
    onState(last ? { kind: 'ready', outputs: last, stale: true } : { kind: 'pending' })
    timer = setTimeout(() => {
      const j = update.start()
      job = j
      j.promise.then(
        (outputs) => {
          if (mine !== seq) return
          last = outputs
          onState({ kind: 'ready', outputs, stale: false })
        },
        (e) => {
          if (mine !== seq || e?.name === 'AbortError') return
          onState({ kind: 'error', message: e instanceof UserError ? e.message : GENERIC })
        },
      )
    }, delay)
  }

  return {
    schedule,
    /** compute now even though the inputs are large */
    refresh() {
      if (!current) return
      force = true
      schedule(current)
    },
    dispose() {
      clearTimeout(timer)
      job?.cancel()
      job = null
      seq++
    },
  }
}
