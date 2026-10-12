import { useEffect, useState } from 'react'

// hash routing keeps the app working under file:// in Electron without a router dependency
export function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}
