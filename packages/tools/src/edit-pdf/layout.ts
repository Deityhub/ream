// Breaking text into lines, given a way to measure it. The panel measures with the browser's canvas and the run with
// the font file's own widths: the same fonts and the same rule, so lines break in the same places on screen and in the file.

/**
 * The lines of `text` in a box `width` wide: the user's own line breaks are kept, words go on the line while they fit,
 * and a word longer than a whole line is broken between letters. Spaces at the end of a line don't count.
 */
export function wrapLines(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    // a line that is still too wide is a single long word: as many of its letters as fit go on a line of their own
    const breakLong = () => {
      while (line.length > 1 && measure(line.trimEnd()) > width) {
        let cut = 1
        while (cut < line.length && measure(line.slice(0, cut + 1)) <= width) cut++
        out.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    for (const token of paragraph.split(/(\s+)/)) {
      if (!token) continue
      if (!line || measure((line + token).trimEnd()) <= width) line += token
      else if (/^\s+$/.test(token)) {
        // spaces that don't fit end the line
        out.push(line.trimEnd())
        line = ''
      } else {
        out.push(line.trimEnd())
        line = token
      }
      breakLong()
    }
    out.push(line.trimEnd())
  }
  return out
}
