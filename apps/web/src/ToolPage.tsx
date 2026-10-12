import { useState } from 'react'
import { Button, Card, Dropzone, Icon } from '@ream/ui'
import type { Tool } from '@ream/core'

const size = (n: number) => (n < 1024 ** 2 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`)

export function ToolPage({ tool }: { tool?: Tool }) {
  const [files, setFiles] = useState<File[]>([])

  const back = (
    <a href="#/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <Icon name="arrow-left" className="size-4" /> All tools
    </a>
  )
  if (!tool) {
    return (
      <>
        {back}
        <p className="text-sm">That tool doesn't exist.</p>
      </>
    )
  }

  return (
    <>
      {back}
      <h1 className="text-xl font-semibold">{tool.title}</h1>
      <p className="mb-4 text-sm text-muted">{tool.description}</p>
      <Dropzone accept={tool.accept} onFiles={(f) => setFiles((cur) => [...cur, ...f])} />
      {files.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted">{size(f.size)}</span>
              <button
                onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
                className="rounded p-1 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Icon name="x" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Card className="mt-4">
        {tool.status === 'soon' ? (
          <p className="text-sm text-muted">This tool isn't built yet. Files you add here stay in your browser and nothing runs.</p>
        ) : (
          <Button disabled={files.length === 0}>Run</Button>
        )}
      </Card>
    </>
  )
}
