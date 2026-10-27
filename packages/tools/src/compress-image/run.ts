import { UserError, type FileData, type RunFn } from '@ream/core'
import { colourChunks, decodeGif, encodeGif, encodeJpeg, encodePng, quantize, readSegments, withOrientation, type ImageBuffer } from '@ream/image-core'
import { decodeFile, encodeFile, outName } from '../image-common.ts'
import { formatFor } from '../image-formats.ts'
import type { CompressOptions } from './options.ts'

export type { CompressOptions }

/** the metadata segments to carry into the new JPEG: the colour profile always, the rest on request (its orientation is reset: the pixels are already upright) */
function segmentsToKeep(bytes: Uint8Array, keepMetadata: boolean): Uint8Array[] {
  const out: Uint8Array[] = []
  for (const s of readSegments(bytes).segments) {
    if (s.kind === 'icc') out.push(s.bytes)
    else if (keepMetadata && s.kind === 'exif') out.push(withOrientation(s.bytes, 1))
    else if (keepMetadata && (s.kind === 'xmp' || s.kind === 'iptc')) out.push(s.bytes)
  }
  return out
}

async function compress(f: FileData, o: CompressOptions): Promise<FileData> {
  const fmt = formatFor(f.type)
  const name = outName(f.name, '-compressed', f.type === 'image/gif' ? { ...fmt, mime: 'image/gif', ext: 'gif' } : fmt)
  let bytes: Uint8Array
  let img: ImageBuffer | undefined
  if (f.type === 'image/gif') {
    // every frame is kept; fewer colours per frame is the saving
    const gif = decodeGif(f.bytes, { maxFrames: 500 })
    bytes = encodeGif(gif.frames, { loops: gif.loops, colors: o.reduceColors ? o.colors : 256, dither: o.dither })
  } else {
    img = await decodeFile(f)
    if (fmt.mime === 'image/jpeg') {
      const flat = img.data.slice()
      // JPEG has no transparency: what a PNG-with-alpha input shows through becomes white
      for (let i = 0; i < flat.length; i += 4) {
        const a = flat[i + 3] / 255
        for (let c = 0; c < 3; c++) flat[i + c] = flat[i + c] * a + 255 * (1 - a)
        flat[i + 3] = 255
      }
      bytes = encodeJpeg({ width: img.width, height: img.height, data: flat }, { quality: o.quality, segments: segmentsToKeep(f.bytes, o.keepMetadata) })
    } else if (fmt.mime === 'image/png') {
      bytes = await encodePng(o.reduceColors ? quantize(img, o.colors, o.dither) : img, { chunks: colourChunks(f.bytes) })
    } else {
      bytes = (await encodeFile(img, fmt, o.quality, name)).bytes
    }
  }
  // a file that was already as small as it gets stays as it was, rather than growing
  const sameFormat = f.type === fmt.mime || f.type === 'image/gif'
  if (sameFormat && bytes.length >= f.bytes.length) return { name, type: f.type, bytes: f.bytes }
  return { name, type: f.type === 'image/gif' ? 'image/gif' : fmt.mime, bytes }
}

export const run: RunFn<CompressOptions> = async (files, options, { progress }) => {
  if (!(options.quality >= 1 && options.quality <= 100)) throw new UserError('Quality must be between 1 and 100.')
  const outputs: FileData[] = []
  for (const [i, f] of files.entries()) {
    outputs.push(await compress(f, options))
    progress((i + 1) / files.length)
  }
  return outputs
}
