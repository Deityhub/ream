import { browserPlatform } from '@ream/pdf-render'
import { browserFonts } from './source.ts'
import { standardFonts } from './standard.ts'

/** call once in a worker that renders pages: unembedded standard fonts are drawn with the bundled look-alikes */
export function installStandardFonts() {
  browserPlatform.standardFont = standardFonts(browserFonts)
}
