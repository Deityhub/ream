import { useEffect, useState } from 'react'
import type { Tool } from '@ream/core'
import { createPreviewController, type PreviewState } from './previewController'
import { runTool } from './runtime'

/** Live result of running the tool on the current files and options (the same engine as the Run button). */
export function usePreview(tool: Tool | undefined, files: File[], options: unknown, enabled: boolean) {
  const [state, setState] = useState<PreviewState>({ kind: 'idle' })
  const [controller] = useState(() => createPreviewController(setState))

  useEffect(() => {
    controller.schedule({
      ready: !!tool && enabled && options !== null && files.length >= tool.minFiles,
      bytes: files.reduce((n, f) => n + f.size, 0),
      start: () => runTool(tool!.id, files, options, () => {}),
    })
  }, [controller, tool, files, options, enabled])

  useEffect(() => () => controller.dispose(), [controller])

  return { state, refresh: () => controller.refresh() }
}
