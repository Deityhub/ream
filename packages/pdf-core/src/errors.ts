import { UserError } from '@ream/core'

// Extending UserError tells the UI these messages can be shown to people as written.
export class PdfParseError extends UserError {
  constructor(message: string) {
    super(message)
    this.name = 'PdfParseError'
  }
}

/** A kind of protection we can't open (not the standard password handler, or a damaged encryption entry). */
export class PdfEncryptedError extends UserError {
  constructor() {
    super("This PDF uses protection Ream can't open yet.")
    this.name = 'PdfEncryptedError'
  }
}

/** The PDF needs a password. `incorrect` is true when one was given and it didn't work. */
export class PdfPasswordError extends UserError {
  incorrect: boolean
  constructor(incorrect: boolean) {
    super(incorrect ? "That password isn't right." : 'This PDF is password protected.')
    this.name = 'PdfPasswordError'
    this.incorrect = incorrect
  }
}

/** bad page selection from the user, e.g. "9-12" on a 5 page file */
export class PdfRangeError extends UserError {
  constructor(message: string) {
    super(message)
    this.name = 'PdfRangeError'
  }
}

/** a font file we can't use: not TrueType, not allowed to be embedded, or without a letter the text needs */
export class PdfFontError extends UserError {
  constructor(message: string) {
    super(message)
    this.name = 'PdfFontError'
  }
}
