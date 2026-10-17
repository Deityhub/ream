import { useEffect, useRef, useState } from 'react'
import { Icon } from '@ream/ui'
import type { InstalledFont } from './book.ts'
import { downloadFreeFont } from './download.ts'
import { EXACT, LOOK_ALIKE_NAMES, closestFamily, lookAlikeFor, weightOf } from './match.ts'
import { inputClass } from '../fields.tsx'

// Chromium's local font access: the font files installed on the computer, once the user (or Electron) allows it
type LocalFont = { family: string; style: string; postscriptName: string; blob(): Promise<Blob> }
const queryLocalFonts = () => (globalThis as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts
async function permission(): Promise<PermissionState | 'unsupported'> {
  if (!queryLocalFonts()) return 'unsupported'
  try {
    return (await navigator.permissions.query({ name: 'local-fonts' as PermissionName })).state
  } catch {
    return 'prompt'
  }
}

type FontFile = { faces: { family: string; typographic?: string; style: string; postscript: string; embeddable: boolean }[]; bytes: Uint8Array }
type Props = {
  file?: File
  readOfficeFonts?: (f: File) => Promise<string[]>
  readFontFile?: (f: Blob) => Promise<FontFile>
  value: InstalledFont[]
  onChange: (v: InstalledFont[]) => void
}

const servesFor = (f: InstalledFont, name: string) => (f.for ?? f.family).toLowerCase() === name.toLowerCase()
/** at most these styles of an installed family are taken: the file's own text needs no more */
const STYLES = /^(regular|book|roman|normal|light|bold|italic|bold italic|light italic|oblique|bold oblique|semibold|medium)$/i

/**
 * The fonts a document uses and what each is drawn with. Fonts installed on the computer are used by themselves once the
 * browser allows reading them (Electron always does; Chrome asks once). Missing ones can be added from font files (several
 * at once, each matched to the font it is) or downloaded when they are free. Everything found goes into the options.
 */
export function FontsPanel({ file, readOfficeFonts, readFontFile, value, onChange }: Props) {
  const [wanted, setWanted] = useState<string[]>([])
  const [access, setAccess] = useState<PermissionState | 'unsupported'>('unsupported')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [loose, setLoose] = useState<InstalledFont[][]>([])
  /** fonts found on the computer whose licence forbids embedding them, by the font of the file they would stand for */
  const [blocked, setBlocked] = useState<Map<string, string>>(new Map())
  const latest = useRef(value)
  latest.current = value
  const update = (v: InstalledFont[]) => {
    latest.current = v
    onChange(v)
  }

  /** the installed fonts for every font of the file that has nothing yet */
  const findInstalled = async (names: string[]) => {
    const query = queryLocalFonts()
    if (!query) return
    setBusy('Looking for installed fonts…')
    try {
      const local = await query()
      setAccess('granted')
      const families = [...new Set(local.map((f) => f.family))]
      // a collection (.ttc) comes back once per face: each file is read (and checked in the worker) once
      const files = new Map<string, Promise<FontFile | null>>()
      const found: InstalledFont[] = []
      const refused = new Map<string, string>()
      for (const name of names) {
        if (latest.current.some((f) => servesFor(f, name))) continue
        const m = closestFamily(name, families)
        if (!m) continue
        const mine: InstalledFont[] = []
        for (const f of local.filter((l) => l.family === m.family && STYLES.test(l.style))) {
          const blob = await f.blob()
          const k = `${blob.size}:${f.family}`
          if (!files.has(k)) files.set(k, readFontFile ? readFontFile(blob).catch(() => null) : blob.arrayBuffer().then((b) => ({ faces: [], bytes: new Uint8Array(b) })))
          const info = await files.get(k)!
          if (!info) continue
          const face = info.faces.find((x) => x.postscript === f.postscriptName)
          // fonts whose licence forbids embedding are respected: they aren't used
          if (face && !face.embeddable) continue
          mine.push({ family: f.family, style: f.style, postscript: f.postscriptName, bytes: info.bytes, for: m.exact ? undefined : name, source: 'installed' })
        }
        // used only when the text's own weight can be embedded (Gill Sans allows SemiBold but not Light or Regular)
        if (mine.some((f) => Math.abs(weightOf(f.style) - weightOf(name)) <= 150)) found.push(...mine)
        else refused.set(name, m.family)
      }
      setBlocked(refused)
      if (found.length) update([...latest.current, ...found])
    } catch {
      setAccess('denied')
      setNote('The fonts on this computer could not be read. The browser may have been told not to share them.')
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
    let live = true
    setWanted([])
    setNote('')
    setLoose([])
    setBlocked(new Map())
    if (!file || !readOfficeFonts) return
    ;(async () => {
      const names = await readOfficeFonts(file).catch(() => [])
      if (!live) return
      setWanted(names)
      const state = await permission()
      if (!live) return
      setAccess(state)
      // allowed before (or in Electron): installed fonts are used without asking again
      if (state === 'granted') await findInstalled(names)
    })()
    return () => {
      live = false
    }
  }, [file, readOfficeFonts])

  const missing = wanted.filter((w) => !value.some((f) => servesFor(f, w)))

  const addFiles = async (list: FileList) => {
    if (!readFontFile) return
    setBusy('Reading font files…')
    const unmatched: InstalledFont[][] = []
    const added: InstalledFont[] = []
    const bad: string[] = []
    for (const f of [...list]) {
      const info = await readFontFile(f).catch(() => null)
      if (!info?.faces.length) { bad.push(`${f.name} (not a font file)`); continue }
      const usable = info.faces.filter((face) => face.embeddable)
      if (!usable.length) { bad.push(`${f.name} (its licence doesn't allow embedding, or Ream can't embed its kind of outlines)`); continue }
      const faces = usable.map((face): InstalledFont => ({ family: face.family, style: face.style, postscript: face.postscript, bytes: info.bytes, source: 'file' }))
      // the font of the document this file is: by its family, or its family without the weight
      const target = wanted.find((w) => info.faces.some((face) => closestFamily(w, [face.family, ...(face.typographic ? [face.typographic] : [])])))
      if (target) added.push(...faces.map((face) => ({ ...face, for: target })))
      else unmatched.push(faces)
    }
    if (added.length) update([...latest.current.filter((x) => !added.some((a) => servesFor(x, a.for!) && x.source !== 'file')), ...added])
    setLoose((l) => [...l, ...unmatched])
    setNote(bad.length ? `Not used: ${bad.join(', ')}. Ream takes .ttf, .otf, .ttc and .woff files that allow embedding.` : '')
    setBusy('')
  }

  const download = async () => {
    setBusy('Downloading free fonts…')
    const got: string[] = []
    const none: string[] = []
    let all = latest.current
    for (const name of missing) {
      try {
        const files = await downloadFreeFont(name)
        if (files) { all = [...all, ...files]; got.push(name) }
        else none.push(name)
      } catch {
        none.push(name)
      }
    }
    update(all)
    setNote([got.length ? `Downloaded ${got.join(', ')}.` : '', none.length ? `Not free to download: ${none.join(', ')}. Add a font file you have for ${none.length === 1 ? 'it' : 'them'}.` : ''].filter(Boolean).join(' '))
    setBusy('')
  }

  const status = (w: string) => {
    const mine = value.filter((f) => servesFor(f, w))
    if (mine.length) {
      const f = mine[0]
      const what = f.source === 'download' ? `Downloaded ${f.family}` : f.source === 'file' ? `From ${f.family} (added file)` : `Installed${f.family.toLowerCase() === w.toLowerCase() ? '' : `: ${f.family}`}`
      return { ok: true, text: f.family.toLowerCase() === w.toLowerCase() || f.source === 'file' ? what : `${what}, a close match` }
    }
    const stand = LOOK_ALIKE_NAMES[lookAlikeFor(w)]
    const refused = blocked.get(w)
    if (refused) return { ok: false, text: `${refused} is installed, but its licence doesn't allow embedding it: ${stand} stands in` }
    return { ok: false, text: EXACT.test(w) ? `Not on this computer: ${stand}, with the same letter widths` : `Not on this computer: ${stand} stands in` }
  }

  if (!wanted.length) return null
  return (
    <section aria-label="Fonts" className="space-y-2 text-sm">
      <p className="font-medium">Fonts in this file</p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {wanted.map((w) => {
          const s = status(w)
          return (
            <li key={w} className="flex items-start gap-2 px-2.5 py-1.5">
              <Icon name={s.ok ? 'check' : 'alert'} className={`mt-0.5 size-4 shrink-0 ${s.ok ? 'text-accent' : 'text-warning'}`} />
              <span className="min-w-0 flex-1">
                <span className="block break-words">{w}</span>
                <span className="block text-xs text-muted">{s.text}</span>
              </span>
              {s.ok && (
                <button type="button" aria-label={`Stop using the font found for ${w}`} className="rounded p-1 text-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:p-3" onClick={() => update(value.filter((f) => !servesFor(f, w)))}>
                  <Icon name="x" className="size-3.5" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {loose.map((faces, i) => (
        <label key={i} className="flex flex-wrap items-center gap-2 text-xs">
          <span>{faces[0].family} isn't used by this file. Use it for</span>
          <select
            className={inputClass}
            value=""
            onChange={(e) => {
              const target = e.target.value
              if (!target) return
              update([...latest.current.filter((x) => !servesFor(x, target)), ...faces.map((f) => ({ ...f, for: target }))])
              setLoose((l) => l.filter((_, k) => k !== i))
            }}
          >
            <option value="">Choose a font…</option>
            {wanted.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="flex flex-wrap gap-2">
        {access === 'prompt' && missing.length > 0 && (
          <button type="button" disabled={!!busy} onClick={() => findInstalled(missing)} className="rounded-lg border border-line bg-surface px-3 py-1.5 font-medium hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 pointer-coarse:min-h-11">
            Use fonts on this computer
          </button>
        )}
        {readFontFile && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 font-medium hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent pointer-coarse:min-h-11">
            <Icon name="upload" className="size-4" />
            Add font files
            <input
              type="file"
              multiple
              accept=".ttf,.otf,.ttc,.woff,font/ttf,font/otf,font/collection,font/woff"
              className="sr-only"
              onChange={async (e) => {
                if (e.target.files?.length) await addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        )}
        {missing.length > 0 && (
          <button type="button" disabled={!!busy} onClick={download} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 font-medium hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 pointer-coarse:min-h-11">
            <Icon name="download" className="size-4" />
            Download free fonts
          </button>
        )}
      </div>
      {busy && <p role="status" className="text-xs text-muted">{busy}</p>}
      {note && <p className="text-xs text-muted">{note}</p>}
      {missing.length > 0 && <p className="text-xs text-muted">Downloads come from Fontsource (free, openly licensed fonts). Only the font's name is sent; your file stays on this device.</p>}
    </section>
  )
}
