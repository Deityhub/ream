// Constants only, shared by the panel and the run.
export type ProtectPdfOptions = {
  /** needed to open the file */
  password: string
  /** typed a second time, to catch a slip; compared in the run */
  confirm: string
  /** lifts the restrictions below; empty means one is made up when something is restricted */
  ownerPassword: string
  allowPrint: boolean
  allowCopy: boolean
  allowModify: boolean
  /** AES-128 instead of AES-256, for very old readers */
  compatible: boolean
}

export const defaultOptions: ProtectPdfOptions = { password: '', confirm: '', ownerPassword: '', allowPrint: true, allowCopy: true, allowModify: true, compatible: false }
