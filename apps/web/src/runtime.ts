import { UserError, checkLimits, type FileData } from '@ream/core'

export type Running = { promise: Promise<FileData[]>; cancel: () => void }

const spawn = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

// One worker is kept between runs, so a preview after an option change doesn't load the engine again and finds the
// files it decoded last time (see `keyed` in worker.ts). A run that starts while it is busy gets a worker of its own.
let idle: Worker | undefined

/** start the worker and load a tool's engine before the first run needs them (a tool page calls it on open) */
export function warmTool(id: string) {
  idle ??= spawn()
  idle.postMessage({ warm: id })
}

// the same File keeps its key across runs, so the worker can tell it already has it
const keys = new WeakMap<Blob, string>()
let nextKey = 0
const keyOf = (f: Blob) => keys.get(f) ?? (keys.set(f, String(++nextKey)), keys.get(f)!)

/** Run a tool's engine in a Web Worker. Cancelling terminates the worker (the only way to stop work in progress) and rejects with an AbortError. */
export function runTool(id: string, files: File[], options: unknown, onProgress: (fraction: number) => void): Running {
  const worker = idle ?? spawn()
  idle = undefined
  let finished = false
  const finish = (reuse: boolean) => {
    finished = true
    if (reuse && !idle) idle = worker
    else worker.terminate()
  }
  let reject: (e: unknown) => void = () => {}
  const promise = new Promise<FileData[]>((resolve, rej) => {
    reject = rej
    worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') return onProgress(m.value)
      finish(true)
      if (m.type === 'done') resolve(m.outputs)
      else rej(m.user ? new UserError(m.message) : new Error(m.message))
    }
    worker.onerror = (e) => {
      finish(false)
      rej(new Error(e.message || "Couldn't start the background worker"))
    }
    checkLimits(files) // throws inside the executor, which rejects the promise
    Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, key: keyOf(f), bytes: new Uint8Array(await f.arrayBuffer()) })))
      .then((inputs) => worker.postMessage({ id, files: inputs, options }, inputs.map((i) => i.bytes.buffer)))
      .catch(rej)
  })
  return {
    promise,
    cancel() {
      if (finished) return
      finish(false)
      reject(new DOMException('Cancelled', 'AbortError'))
    },
  }
}
