import { useEffect } from 'react'
import { findTool } from '@ream/tools'
import { useHash } from './useHash'
import { Home } from './Home'
import { ToolPage } from './ToolPage'
import { Landing } from './Landing'

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
  return <Landing />
}
