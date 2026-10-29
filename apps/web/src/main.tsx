import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { startPwa } from './pwa'
import { UpdateBar } from './UpdateBar'
import { upgradeLegacyUrl } from './router'

upgradeLegacyUrl()
startPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateBar />
  </StrictMode>,
)
