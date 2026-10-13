import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }

export function Button({ variant = 'primary', className = '', ...rest }: Props) {
  const look =
    variant === 'primary'
      ? 'bg-accent text-on-accent hover:bg-accent-hover'
      : 'border border-line bg-surface hover:bg-surface-2'
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150 pointer-coarse:min-h-11 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${look} ${className}`}
      {...rest}
    />
  )
}
