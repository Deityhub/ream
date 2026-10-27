import type { HTMLAttributes } from 'react'

/** A line drawing: hairline frame with corner marks, no fill of its own. */
export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`blueprint border border-line p-4 ${className}`} {...rest} />
}
