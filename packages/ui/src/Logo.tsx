/** Ream's mark: one sheet cut on a diagonal and slid apart (split and merge). Colours follow the theme. */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} strokeWidth={2} strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4H24V12L8 20Z" transform="translate(2.2 -1.1)" fill="var(--accent)" stroke="var(--accent)" />
      <path d="M8 20L24 12V28H8Z" transform="translate(-2.2 1.1)" fill="var(--accent-2)" stroke="var(--accent-2)" />
    </svg>
  )
}
