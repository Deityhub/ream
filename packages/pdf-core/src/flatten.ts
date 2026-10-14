// Flatten: bake form fields and annotations into the page so they can no longer be edited, only seen.
import { PdfName, PdfRef, PdfStream, isDict, isName, type PdfDict, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'
import { acroForm, kindOf, shownText, terminalFields, textPicture, type Widget } from './forms.ts'
import { appearanceMatrix, isVisibleAnnotation, normalAppearanceRef } from './annot.ts'
import { editDocument } from './rewrite.ts'
import { ascii } from './bytes.ts'
import type { FontLook } from './appearance.ts'

export type FlattenOptions = {
  /** form fields: what they show stays, the fields go */
  forms: boolean
  /** notes, highlights, stamps, drawings and the like */
  comments: boolean
}

// annotation kinds that draw something and are not form fields; links, pop-ups, files and media are left alone
const MARKUP = new Set(['Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink'])

const n = (v: number) => String(Math.round(v * 10000) / 10000)

/** the page with the annotations' pictures drawn into its content; how many were flattened is returned with the file */
export async function flattenPdf(doc: PdfDocument, o: FlattenOptions): Promise<{ bytes: Uint8Array; flattened: number }> {
  const pages = doc.pages()
  const widgets = new Map<PdfDict, { t: ReturnType<typeof terminalFields>[number]; w: Widget }>()
  for (const t of terminalFields(doc)) for (const w of t.widgets) widgets.set(w.dict, { t, w })
  const form = acroForm(doc)
  const redraw = !!form && doc.resolve(form.get('NeedAppearances')) === true
  let flattened = 0

  const bytes = await editDocument(doc, (e) => {
    const fonts = new Map<string, FontLook>()
    pages.forEach((page) => {
      const annots = doc.resolve(page.dict.get('Annots'))
      if (!page.ref || !Array.isArray(annots)) return
      const keep: PdfObj[] = []
      const draw: { res: string; ref: PdfRef; matrix: number[] }[] = []
      for (const item of annots) {
        const a = doc.resolve(item)
        if (!isDict(a)) {
          keep.push(item)
          continue
        }
        const sub = doc.resolve(a.get('Subtype'))
        const isWidget = isName(sub, 'Widget')
        const take = isWidget ? o.forms : o.comments && sub instanceof PdfName && MARKUP.has(sub.value)
        if (!take) {
          keep.push(item)
          continue
        }
        if (isVisibleAnnotation(doc, a)) {
          let ref: PdfRef | null = normalAppearanceRef(doc, a)
          let stream = ref ? (doc.resolve(ref) as PdfStream) : null
          const known = widgets.get(a)
          // a text box with no picture (or a form that asks viewers to draw their own) is drawn from its value
          if (known && (!stream || redraw)) {
            const kind = kindOf(known.t)
            if (kind === 'text' || kind === 'choice') {
              const made = textPicture(doc, e, known.t, known.w, kind, shownText(doc, known.t, kind), fonts)
              if (made) {
                stream = made
                ref = e.add(made)
              }
            }
          }
          const matrix = stream && appearanceMatrix(doc, a, stream)
          if (ref && matrix) draw.push({ res: `ReamFlat${flattened++}`, ref, matrix })
        }
      }
      if (keep.length === annots.length) return
      const d = e.edit(page.ref)
      if (keep.length) d.set('Annots', keep)
      else d.delete('Annots')
      if (!draw.length) return
      // resources: the page's own (or inherited) with the pictures added under /XObject
      const inherited = d.has('Resources') ? d.get('Resources')! : (page.inherited.get('Resources') ?? new Map())
      const resRef = inherited instanceof PdfRef ? inherited : null
      const res: PdfDict = resRef ? e.edit(resRef) : new Map(doc.resolve(inherited) as PdfDict)
      if (!resRef) d.set('Resources', res)
      const xo = res.get('XObject')
      const xoDict: PdfDict = xo instanceof PdfRef ? e.edit(xo) : new Map(isDict(doc.resolve(xo)) ? (doc.resolve(xo) as PdfDict) : [])
      if (!(xo instanceof PdfRef)) res.set('XObject', xoDict)
      for (const x of draw) xoDict.set(x.res, x.ref)
      // the page's own content is wrapped in q/Q so whatever state it leaves behind can't move the pictures
      const cur = d.has('Contents') ? d.get('Contents')! : null
      const list = Array.isArray(doc.resolve(cur)) ? (doc.resolve(cur) as PdfObj[]) : cur ? [cur] : []
      const stream = (s: string) => e.add(new PdfStream(new Map(), ascii(s)))
      d.set('Contents', [stream('q\n'), ...list, stream('Q\n' + draw.map((x) => `q ${x.matrix.map(n).join(' ')} cm /${x.res} Do Q\n`).join(''))])
    })
    if (o.forms) e.catalog.delete('AcroForm')
  })
  return { bytes, flattened }
}
