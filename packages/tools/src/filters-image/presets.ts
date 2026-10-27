// The adjustments and the one-click looks made from them. Constants only: the panel and the run both import this.
export type FilterOptions = {
  /** -100..100 each; 0 is unchanged */
  brightness: number
  contrast: number
  saturation: number
  warmth: number
  /** 0..100 */
  sepia: number
  vignette: number
  blur: number
  sharpen: number
}

export const NONE: FilterOptions = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sepia: 0, vignette: 0, blur: 0, sharpen: 0 }

export const PRESETS: { id: string; label: string; values: Partial<FilterOptions> }[] = [
  { id: 'original', label: 'Original', values: {} },
  { id: 'mono', label: 'Black and white', values: { saturation: -100, contrast: 15 } },
  { id: 'sepia', label: 'Sepia', values: { sepia: 100, contrast: 5 } },
  { id: 'vivid', label: 'Vivid', values: { saturation: 35, contrast: 15 } },
  { id: 'fade', label: 'Fade', values: { brightness: 8, contrast: -20, saturation: -20 } },
  { id: 'warm', label: 'Warm', values: { warmth: 40, saturation: 10 } },
  { id: 'cool', label: 'Cool', values: { warmth: -40, saturation: 5 } },
  { id: 'dramatic', label: 'Dramatic', values: { contrast: 35, saturation: -15, vignette: 50, sharpen: 25 } },
  { id: 'vintage', label: 'Vintage', values: { sepia: 45, contrast: -10, vignette: 40, warmth: 15 } },
]

export const presetValues = (id: string): FilterOptions => ({ ...NONE, ...PRESETS.find((p) => p.id === id)?.values })
/** the look whose values the options match, if any */
export const presetOf = (o: FilterOptions) => PRESETS.find((p) => (Object.keys(NONE) as (keyof FilterOptions)[]).every((k) => o[k] === presetValues(p.id)[k]))?.id
export const isUnchanged = (o: FilterOptions) => (Object.keys(NONE) as (keyof FilterOptions)[]).every((k) => o[k] === 0)
