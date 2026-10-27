import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary'; size?: 'md' | 'lg' }

/** Industry's button: condensed type, square. The primary is the one solid object on a page and wears the corner marks. */
export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: Props) {
  const look =
    variant === 'primary'
      ? 'blueprint border border-accent bg-accent text-on-accent hover:bg-accent-hover hover:border-accent-hover'
      : 'border border-line hover:bg-ink/7 active:bg-ink/14'
  const box = size === 'lg' ? 'min-h-11 px-5 text-[17px]' : 'min-h-9 px-3.5 text-[15px] pointer-coarse:min-h-11'
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 font-heading font-semibold tracking-wide transition-colors duration-150 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${box} ${look} ${className}`}
      {...rest}
    />
  )
}
