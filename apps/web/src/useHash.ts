import { useEffect, useState } from 'react'

// hash routing needs no server rewrites (any static host serves index.html) and no router dependency
export function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}
