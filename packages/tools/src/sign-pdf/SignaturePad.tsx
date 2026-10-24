import { useEffect, useRef, useState, type PointerEvent } from 'react'
import '@fontsource/dancing-script/400.css'
import '@fontsource/caveat/400.css'
import '@fontsource/great-vibes/400.css'
import { Icon } from '@ream/ui'
import { inputClass } from '../fields.tsx'
import { trimmedPng } from '../bitmaps.ts'

type Mode = 'draw' | 'type' | 'upload'
const FONTS = [
  { family: 'Dancing Script', label: 'Dancing Script' },
  { family: 'Caveat', label: 'Caveat' },
  { family: 'Great Vibes', label: 'Great Vibes' },
]
const INKS = [
  { value: '#111827', label: 'Black' },
  { value: '#1d4ed8', label: 'Blue' },
  { value: '#7f1d1d', label: 'Dark red' },
]
const PAD = 8
const MAX_UPLOAD = 1200

const trimmed = (canvas: HTMLCanvasElement) => trimmedPng(canvas, PAD)

/** Make a signature three ways; `onChange` gets it as a PNG with a transparent background, or null. */
export function SignaturePad({ onChange }: { onChange: (png: Uint8Array | null) => void }) {
  const [mode, setMode] = useState<Mode>('draw')
  const [ink, setInk] = useState(INKS[0].value)
  const [text, setText] = useState('')
  const [font, setFont] = useState(FONTS[0].family)
  const [clearBg, setClearBg] = useState(true)
  const [upload, setUpload] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const pad = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<{ x: number; y: number } | null>(null)
  const made = useRef<(png: Uint8Array | null) => void>(onChange)
  made.current = onChange

  const publish = async (canvas: HTMLCanvasElement) => {
    const png = await trimmed(canvas)
    made.current(png)
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return png ? URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })) : null
    })
  }
  const reset = () => {
    made.current(null)
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return null
    })
  }

  // typed signature: drawn in the chosen font on a canvas, so the PDF gets a picture (no font to embed)
  useEffect(() => {
    if (mode !== 'type') return
    let live = true
    if (!text.trim()) return reset()
    ;(async () => {
      await document.fonts.load(`120px "${font}"`)
      if (!live) return
      const c = document.createElement('canvas')
      const g = c.getContext('2d')!
      g.font = `120px "${font}"`
      c.width = Math.ceil(g.measureText(text).width) + 80
      c.height = 260
      g.font = `120px "${font}"`
      g.fillStyle = ink
      g.textBaseline = 'alphabetic'
      g.fillText(text, 40, 150)
      await publish(c)
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, text, font, ink])

  // uploaded picture: scaled down if huge, and optionally its light background made see-through
  useEffect(() => {
    if (mode !== 'upload' || !upload) return
    let live = true
    ;(async () => {
      const bmp = await createImageBitmap(upload).catch(() => null)
      if (!bmp || !live) return reset()
      const k = Math.min(1, MAX_UPLOAD / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(bmp.width * k))
      c.height = Math.max(1, Math.round(bmp.height * k))
      const g = c.getContext('2d', { willReadFrequently: true })!
      g.drawImage(bmp, 0, 0, c.width, c.height)
      bmp.close()
      if (clearBg) {
        const img = g.getImageData(0, 0, c.width, c.height)
        for (let i = 0; i < img.data.length; i += 4) {
          // the lighter the pixel, the more see-through: white paper disappears, ink stays
          const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
          img.data[i + 3] = Math.min(img.data[i + 3], Math.max(0, Math.min(255, ((235 - lum) * 255) / 120)))
        }
        g.putImageData(img, 0, 0)
      }
      if (live) await publish(c)
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, upload, clearBg])

  // switching away from a way of making one clears what it made
  const choose = (m: Mode) => {
    setMode(m)
    reset()
    setText('')
    setUpload(null)
  }

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = pad.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * pad.current!.width) / r.width, y: ((e.clientY - r.top) * pad.current!.height) / r.height }
  }
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = at(e)
    drawing.current = p
    const g = pad.current!.getContext('2d')!
    g.fillStyle = ink
    g.beginPath()
    g.arc(p.x, p.y, 2, 0, Math.PI * 2)
    g.fill()
  }
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const from = drawing.current
    if (!from) return
    const p = at(e)
    const g = pad.current!.getContext('2d')!
    g.strokeStyle = ink
    g.lineWidth = 4
    g.lineCap = g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(from.x, from.y)
    g.lineTo(p.x, p.y)
    g.stroke()
    drawing.current = p
  }
  const up = () => {
    if (drawing.current && pad.current) void publish(pad.current)
    drawing.current = null
  }
  const clearPad = () => {
    pad.current?.getContext('2d')?.clearRect(0, 0, pad.current.width, pad.current.height)
    reset()
  }

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Way to make a signature" className="inline-flex rounded-lg border border-line p-0.5 text-sm">
        {(['draw', 'type', 'upload'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => choose(m)}
            className={`rounded-md px-3 py-1 capitalize focus-visible:outline-2 focus-visible:outline-accent ${mode === m ? 'bg-accent text-on-accent' : 'hover:bg-surface-2'}`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode !== 'upload' && (
        <fieldset className="flex flex-wrap items-center gap-3 text-sm">
          <legend className="sr-only">Ink</legend>
          {INKS.map((i) => (
            <label key={i.value} className="flex items-center gap-1.5">
              <input type="radio" name="sig-ink" checked={ink === i.value} onChange={() => setInk(i.value)} />
              <span className="size-3.5 rounded-full border border-line" style={{ background: i.value }} aria-hidden />
              {i.label}
            </label>
          ))}
        </fieldset>
      )}

      {mode === 'draw' && (
        <div className="space-y-2">
          <canvas
            ref={pad}
            width={900}
            height={300}
            aria-label="Draw your signature here"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            className="checker w-full cursor-crosshair touch-none rounded-lg border border-field"
            style={{ aspectRatio: '3 / 1' }}
          />
          <button type="button" onClick={clearPad} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2">
            Clear
          </button>
        </div>
      )}

      {mode === 'type' && (
        <div className="space-y-2">
          <label className="block space-y-1 text-sm">
            Your name
            <input type="text" value={text} onChange={(e) => setText(e.target.value)} maxLength={60} className={`${inputClass} w-full`} />
          </label>
          <div className="flex flex-wrap gap-2">
            {FONTS.map((f) => (
              <label key={f.family} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xl ${font === f.family ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'}`} style={{ fontFamily: `"${f.family}"` }}>
                <input type="radio" name="sig-font" checked={font === f.family} onChange={() => setFont(f.family)} className="sr-only" />
                {text.trim() || f.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {mode === 'upload' && (
        <div className="space-y-2">
          {/* the native file control is hidden; this looks and acts like a button, and shows what was chosen */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-2 has-focus-visible:outline-2 has-focus-visible:outline-accent">
              <Icon name="upload" className="size-4" />
              {upload ? 'Choose another picture' : 'Choose a picture of your signature'}
              <input type="file" accept="image/*" onChange={(e) => setUpload(e.target.files?.[0] ?? null)} className="sr-only" />
            </label>
            {upload && <span className="min-w-0 truncate text-sm text-muted">{upload.name}</span>}
          </div>
          {!upload && <p className="text-xs text-muted">A photo or scan of your signature on white paper works best.</p>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={clearBg} onChange={(e) => setClearBg(e.target.checked)} />
            Make the paper see-through
          </label>
        </div>
      )}

      {preview && mode !== 'draw' && (
        <figure className="space-y-1">
          <div className="checker flex min-h-16 items-center justify-center rounded-lg border border-line p-2">
            <img src={preview} alt="Your signature" className="max-h-24 max-w-full" />
          </div>
        </figure>
      )}
    </div>
  )
}
