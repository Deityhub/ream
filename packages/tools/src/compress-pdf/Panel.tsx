import type { PanelProps } from '../panels.ts'
import { LEVELS, defaultOptions, type CompressLevel, type CompressPdfOptions as O } from './options.ts'

export { defaultOptions }

const CHOICES: { value: CompressLevel; title: string; note: string }[] = [
  { value: 'lossless', title: 'Lossless', note: 'Looks exactly the same. Rewrites the file more compactly and stores repeated fonts and pictures once. Pictures are not touched.' },
  { value: 'balanced', title: 'Balanced', note: `Pictures are saved as JPG at quality ${LEVELS.balanced.quality}, and any picture sharper than ${LEVELS.balanced.dpi} dpi is brought down to that. Good for screen and normal printing.` },
  { value: 'small', title: 'Smallest', note: `Quality ${LEVELS.small.quality} and ${LEVELS.small.dpi} dpi. Pictures look softer, the file is much smaller. Good for sending by email.` },
]

export function Panel({ options, onChange }: PanelProps<O>) {
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">How much to compress</legend>
        {CHOICES.map((c) => (
          <label key={c.value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="compress-level" checked={options.level === c.value} onChange={() => onChange({ level: c.value })} className="mt-0.5" />
            <span>
              {c.title}
              <span className="block text-xs text-muted">{c.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted">
        Text, drawings, links, bookmarks and forms stay as they are. Page thumbnails and the private data of editing programs are removed, and a digital signature no longer
        holds. A file that can't get smaller is returned unchanged.
      </p>
    </div>
  )
}
