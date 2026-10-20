// Options of Fill PDF form, shared by the panel and the run (no engine code here).

export type FillFormOptions = {
  /** only the fields changed from the file's own values, by full field name */
  values: Record<string, string | boolean>
  /** draw the answers into the pages and remove the fields, so they can't be changed */
  lock: boolean
}

export const defaultOptions: FillFormOptions = { values: {}, lock: false }

// the letters a form's standard font can show (Windows-1252): field pictures are drawn with it
const EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
const writable = (c: string) => {
  const n = c.codePointAt(0)!
  return c === '\n' || c === '\r' || c === '\t' || (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || EXTRA.includes(c)
}

/** the characters of a value a form field can't show, each once */
export const unwritable = (text: string) => [...new Set([...text].filter((c) => !writable(c)))]
