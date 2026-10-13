// Parsed PDF values. Dict keys are plain strings without the leading slash.

export class PdfName {
  value: string
  constructor(value: string) {
    this.value = value
  }
}

export class PdfRef {
  num: number
  gen: number
  constructor(num: number, gen = 0) {
    this.num = num
    this.gen = gen
  }
}

export class PdfString {
  bytes: Uint8Array
  hex: boolean
  constructor(bytes: Uint8Array, hex = false) {
    this.bytes = bytes
    this.hex = hex
  }
}

/** bare word the parser did not recognise as a value (obj, endobj, stream, R, ...) */
export class PdfKeyword {
  value: string
  constructor(value: string) {
    this.value = value
  }
}

export type PdfObj = number | boolean | null | PdfName | PdfString | PdfRef | PdfStream | Map<string, PdfObj> | PdfObj[]
export type PdfDict = Map<string, PdfObj>

export class PdfStream {
  dict: PdfDict
  /** raw bytes as stored in the file, still encoded with the dict's /Filter */
  data: Uint8Array
  constructor(dict: PdfDict, data: Uint8Array) {
    this.dict = dict
    this.data = data
  }
}

export const name = (v: string) => new PdfName(v)
export const isDict = (o: unknown): o is PdfDict => o instanceof Map
export const isName = (o: unknown, v?: string): o is PdfName => o instanceof PdfName && (v === undefined || o.value === v)
