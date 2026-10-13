import { UserError, checkLimits, type FileData } from '@ream/core'

export type Running = { promise: Promise<FileData[]>; cancel: () => void }

/** Run a tool's engine in a fresh Web Worker. Cancelling terminates the worker and rejects with an AbortError. */
export function runTool(id: string, files: File[], options: unknown, onProgress: (fraction: number) => void): Running {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  let reject: (e: unknown) => void = () => {}
  const promise = new Promise<FileData[]>((resolve, rej) => {
    reject = rej
    worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') return onProgress(m.value)
      worker.terminate()
      if (m.type === 'done') resolve(m.outputs)
      else rej(m.user ? new UserError(m.message) : new Error(m.message))
    }
    worker.onerror = (e) => {
      worker.terminate()
      rej(new Error(e.message || "Couldn't start the background worker"))
    }
    checkLimits(files) // throws inside the executor, which rejects the promise
    Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })))
      .then((inputs) => worker.postMessage({ id, files: inputs, options }, inputs.map((i) => i.bytes.buffer)))
      .catch(rej)
  })
  return {
    promise,
    cancel() {
      worker.terminate()
      reject(new DOMException('Cancelled', 'AbortError'))
    },
  }
}
