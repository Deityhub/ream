import { useEffect } from 'react'
import { findTool } from '@ream/tools'
import { useHash } from './useHash'
import { Home } from './Home'
import { ToolPage } from './ToolPage'
import { Landing } from './Landing'
import { Legal } from './Legal'

export function App() {
  const hash = useHash()
  useEffect(() => {
    scrollTo(0, 0)
  }, [hash])
  const id = hash.match(/^#\/tool\/([\w-]+)$/)?.[1]
  if (id) return <ToolPage key={id} tool={findTool(id)} />
  const cat = hash.match(/^#\/tools\/(pdf|image)$/)?.[1] as 'pdf' | 'image' | undefined
  if (cat) return <Home key={cat} cat={cat} />
  if (hash === '#/tools') return <Home key="all" cat="all" />
  if (hash === '#/licence') return <Legal page="licence" />
  if (hash === '#/notices') return <Legal page="notices" />
  return <Landing />
}
