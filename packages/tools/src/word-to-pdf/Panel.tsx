import type { PanelProps } from '../panels.ts'
import { FontsPanel } from '../fonts/FontsPanel.tsx'
import type { WordToPdfOptions as O } from './run.ts'

export const defaultOptions: O = { localFonts: [] }

export function Panel({ options: o, onChange, files, readOfficeFonts, readFontFile }: PanelProps<O>) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Pages</legend>
      <p className="text-sm">Each section keeps its own paper size, margins and columns, with its headers, footers, footnotes and page numbers. Links in the text stay clickable (a table of contents jumps to its pages and shows their real numbers) and headings become bookmarks.</p>
      <FontsPanel file={files[0]} readOfficeFonts={readOfficeFonts} readFontFile={readFontFile} value={o.localFonts} onChange={(localFonts) => onChange({ ...o, localFonts })} />
      <p className="text-xs text-muted">
        Fonts are embedded: fonts stored in the document are used as they are (Google Docs saves the ones it uses), then the file's own fonts when they are on this computer, added or downloaded; otherwise Calibri, Cambria, Arial, Times New Roman and Courier New become look-alikes with the same letter widths, and other fonts the closest of those, so lines and page breaks can fall a little differently than in Word (a document set in Aptos is the usual case). Letters none of them have (such as Chinese or Japanese) show as ?. Only .docx files open here, not older .doc files. Shapes other than pictures and text boxes, equations, comments and tracked changes are not drawn, text wraps around a picture by its box and not its outline, and right-to-left and complex scripts (Arabic, Hebrew, Hindi) are not shaped.
      </p>
    </fieldset>
  )
}
