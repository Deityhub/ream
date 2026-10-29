import { useEffect } from 'react'
import { findTool } from '@ream/tools'
import { usePath } from './router'
import { parseRoute } from './routes'
import { Home } from './Home'
import { ToolPage } from './ToolPage'
import { Landing } from './Landing'
import { Legal } from './Legal'
import { NotFound } from './NotFound'

export function App() {
  const path = usePath()
  useEffect(() => {
    scrollTo(0, 0)
  }, [path])
  const route = parseRoute(path)
  // a page opened at its address already has its head from the build; moving between pages keeps it in step
  useEffect(() => {
    let live = true
    void import('./seoHead').then((m) => live && m.applyHead(parseRoute(path)))
    return () => {
      live = false
    }
  }, [path])
  switch (route.page) {
    case 'tool':
      return <ToolPage key={route.id} tool={findTool(route.id)} />
    case 'tools':
      return <Home key={route.cat} cat={route.cat} />
    case 'licence':
    case 'notices':
      return <Legal page={route.page} />
    case 'notFound':
      return <NotFound />
    case 'landing':
      return <Landing />
  }
}
