import { Icon } from '@ream/ui'
import { findTool } from '@ream/tools'
import { useHash } from './useHash'
import { ThemeToggle } from './ThemeToggle'
import { Home } from './Home'
import { ToolPage } from './ToolPage'

export function App() {
  const hash = useHash()
  const id = hash.match(/^#\/tool\/([\w-]+)$/)?.[1]
  const tool = id ? findTool(id) : undefined

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center gap-3">
        <a href="#/" className="text-lg font-semibold tracking-tight">Ream</a>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent-soft px-3 py-1 text-xs text-accent">
          <Icon name="lock" className="size-3.5" /> Files stay on your device
        </span>
        <ThemeToggle />
      </header>
      {id ? <ToolPage key={id} tool={tool} /> : <Home />}
    </div>
  )
}
