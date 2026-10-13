export { zip, crc32 } from './zip.ts'

export type Category = 'pdf' | 'image'

export type Tool = {
  id: string
  title: string
  description: string
  category: Category
  icon: string
  /** file extensions ('.pdf') or mime patterns ('image/*') the tool takes */
  accept: string[]
  /** label of the run button, e.g. "Merge PDFs" */
  action: string
  /** takes several input files; false means one */
  multiple: boolean
  minFiles: number
  status: 'ready' | 'soon'
}

/** An error whose message is safe and useful to show the user as-is. Anything else is shown as a generic failure. */
export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}

export type FileData = { name: string; type: string; bytes: Uint8Array }

export type RunContext = { progress: (fraction: number) => void }

/** A tool's engine entry point: pure function of bytes in, bytes out, so it runs in a worker or in tests. */
export type RunFn<O = unknown> = (files: FileData[], options: O, ctx: RunContext) => Promise<FileData[]>

export const LIMITS = { maxFiles: 50, maxFileBytes: 200 * 1024 ** 2, maxTotalBytes: 500 * 1024 ** 2 }

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

export function acceptsFile(f: { name: string; type: string }, accept: string[]): boolean {
  return accept.some((a) =>
    a.startsWith('.') ? f.name.toLowerCase().endsWith(a) : a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : f.type === a,
  )
}

/** refuse inputs the browser tab can't safely hold, with a message that says what to do */
export function checkLimits(files: { name: string; size: number }[]): void {
  if (files.length > LIMITS.maxFiles) throw new UserError(`That's ${files.length} files. The limit is ${LIMITS.maxFiles} at a time.`)
  for (const f of files) {
    if (f.size > LIMITS.maxFileBytes) throw new UserError(`${f.name} is ${formatBytes(f.size)}. The limit is ${formatBytes(LIMITS.maxFileBytes)} per file.`)
  }
  const total = files.reduce((n, f) => n + f.size, 0)
  if (total > LIMITS.maxTotalBytes) throw new UserError(`Those files add up to ${formatBytes(total)}. The limit is ${formatBytes(LIMITS.maxTotalBytes)} in total.`)
}
