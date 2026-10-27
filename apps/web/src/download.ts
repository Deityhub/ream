import { zip, type FileData } from '@ream/core'

/** one file downloads as itself, several as a ZIP */
export function download(outputs: FileData[]) {
  const file = outputs.length === 1 ? outputs[0] : { name: 'ream-output.zip', type: 'application/zip', bytes: zip(outputs) }
  const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.type }))
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export const toFile = (f: FileData) => new File([f.bytes as BlobPart], f.name, { type: f.type })
