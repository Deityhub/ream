// Constants only, shared by the panel and the run.
export type CompressLevel = 'lossless' | 'balanced' | 'small'
export type CompressPdfOptions = { level: CompressLevel }

/** JPEG quality and the resolution pictures are brought down to (dots per inch); 0 means pictures are left alone */
export const LEVELS: Record<CompressLevel, { quality: number; dpi: number }> = {
  lossless: { quality: 0, dpi: 0 },
  balanced: { quality: 72, dpi: 150 },
  small: { quality: 50, dpi: 96 },
}

export const defaultOptions: CompressPdfOptions = { level: 'balanced' }
