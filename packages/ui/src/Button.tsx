import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary'; size?: 'md' | 'lg' }

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: Props) {
  const look =
    variant === 'primary'
      ? 'bg-accent font-bold text-on-accent hover:bg-accent-hover'
      : 'border border-line bg-surface-2 font-semibold hover:border-accent-2'
  const box = size === 'lg' ? 'min-h-13 rounded-xl px-5 text-base' : 'rounded-[10px] px-4 py-2 text-sm pointer-coarse:min-h-11'
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 transition-colors duration-150 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${box} ${look} ${className}`}
      {...rest}
    />
  )
}
