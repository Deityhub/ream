import { Icon, Logo } from '@ream/ui'
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
    <div className={`mx-auto px-4 py-6 ${id ? 'max-w-[1600px]' : 'max-w-5xl'}`}>
      <header className="mb-6 flex items-center gap-3">
        <a href="#/" className="flex items-center gap-2 text-xl font-medium tracking-tight focus-visible:outline-2 focus-visible:outline-accent">
          <Logo size={28} /> Ream
        </a>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent-soft px-3 py-1 text-xs text-accent-ink">
          <Icon name="lock" className="size-3.5" /> Files stay on your device
        </span>
        <ThemeToggle />
      </header>
      {id ? <ToolPage key={id} tool={tool} /> : <Home />}
    </div>
  )
}
