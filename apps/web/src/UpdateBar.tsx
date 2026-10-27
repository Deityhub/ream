import { useState } from 'react'
import { Button } from '@ream/ui'
import { switchToUpdate, usePwa } from './pwa'

/** A new version has been downloaded: offer to switch to it, never switch by itself (a tool may be half way through a job). */
export function UpdateBar() {
  const { update } = usePwa()
  const [later, setLater] = useState(false)
  if (!update || later) return null
  return (
    <div role="status" className="fixed inset-x-4 bottom-4 z-40 flex flex-wrap items-center gap-x-4 gap-y-3 border border-accent-2 bg-surface px-5 py-4 sm:left-auto sm:right-6 sm:max-w-md">
      <p className="min-w-[12rem] flex-1 text-[15px] leading-snug">A new version of Ream is ready. Reloading loses anything not saved yet.</p>
      <div className="flex gap-5">
        <Button variant="secondary" onClick={() => setLater(true)}>Later</Button>
        <Button onClick={switchToUpdate}>Reload</Button>
      </div>
    </div>
  )
}
