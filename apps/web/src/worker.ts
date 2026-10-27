import { UserError, type FileData } from '@ream/core'
import { setCodec } from '@ream/image-core'
import { appCodec } from '@ream/image-core/browser'
import { keepDecoded } from '@ream/tools/image-common'
import { runners } from '@ream/tools/runners'
import { installStandardFonts } from '@ream/tools/standard-fonts'

setCodec(appCodec)
installStandardFonts()

type Request = { id: string; files: FileData[]; options: unknown } | { warm: string }

const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

self.onmessage = async (e: MessageEvent<Request>) => {
  // a tool page opened: load its engine now, quietly (runtime.ts expects no answer)
  if ('warm' in e.data) return void runners[e.data.warm]?.().catch(() => {})
  const { id, files, options } = e.data
  keepDecoded(files.map((f) => f.key))
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
