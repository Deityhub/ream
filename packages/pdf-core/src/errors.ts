import { UserError } from '@ream/core'

// Extending UserError tells the UI these messages can be shown to people as written.
export class PdfParseError extends UserError {
  constructor(message: string) {
    super(message)
    this.name = 'PdfParseError'
  }
}

export class PdfEncryptedError extends UserError {
  constructor() {
    super('This PDF is password protected. Unlock it first.')
    this.name = 'PdfEncryptedError'
  }
}

/** bad page selection from the user, e.g. "9-12" on a 5 page file */
export class PdfRangeError extends UserError {
  constructor(message: string) {
    super(message)
    this.name = 'PdfRangeError'
  }
}
