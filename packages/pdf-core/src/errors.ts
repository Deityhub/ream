export class PdfParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfParseError'
  }
}

export class PdfEncryptedError extends Error {
  constructor() {
    super('This PDF is password protected. Unlock it first.')
    this.name = 'PdfEncryptedError'
  }
}

/** bad page selection from the user, e.g. "9-12" on a 5 page file */
export class PdfRangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfRangeError'
  }
}
