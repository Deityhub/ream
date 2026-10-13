import { UserError, type FileData } from '@ream/core'
import { runners } from '@ream/tools/runners'

type Request = { id: string; files: FileData[]; options: unknown }

const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, files, options } = e.data
  try {
    const load = runners[id]
    if (!load) throw new UserError("That tool isn't available yet.")
    const { run } = await load()
    const outputs = await run(files, options, { progress: (value) => post({ type: 'progress', value }) })
    post({ type: 'done', outputs }, [...new Set(outputs.map((o) => o.bytes.buffer as ArrayBuffer))])
  } catch (err) {
    console.error(err)
    post({
      type: 'error',
      user: err instanceof UserError,
      message: err instanceof UserError ? err.message : 'Something went wrong while processing your files. Nothing was uploaded. Try again, or try a different file.',
    })
  }
}
