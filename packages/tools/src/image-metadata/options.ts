// Constants only, shared by the panel and the run.
export type ImageMetadataOptions = {
  /** all: everything but the colour profile and the orientation; location: only where the picture was taken */
  mode: 'all' | 'location'
}

export const defaultOptions: ImageMetadataOptions = { mode: 'all' }
