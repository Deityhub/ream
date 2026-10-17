// ZIP reader for Office files. The archive is untrusted input: entry counts and sizes are capped, names are not used as paths.
import { crc32 } from './zip.ts'
import { inflateRaw } from './flate.ts'
import { UserError } from './errors.ts'

export type UnzipLimits = { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number }
const DEFAULT: UnzipLimits = { maxEntries: 5000, maxEntryBytes: 200 * 1024 ** 2, maxTotalBytes: 500 * 1024 ** 2 }

const bad = () => new UserError('This file is damaged or is not a ZIP-based file.')

/**
 * Every file of a ZIP archive by name. Handles stored and deflated entries; refuses encrypted entries, ZIP64 and anything
 * that expands past the limits. Directory entries are left out.
 */
export async function unzip(data: Uint8Array, limits: Partial<UnzipLimits> = {}): Promise<Map<string, Uint8Array>> {
  const lim = { ...DEFAULT, ...limits }
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let eocd = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw bad()
  const count = v.getUint16(eocd + 10, true)
  const cdSize = v.getUint32(eocd + 12, true)
  let at = v.getUint32(eocd + 16, true)
  if (count === 0xffff || cdSize === 0xffffffff || at === 0xffffffff) throw new UserError('This archive uses ZIP64, which is not supported.')
  if (count > lim.maxEntries) throw new UserError(`This file holds ${count} parts, more than the ${lim.maxEntries} allowed.`)
  const out = new Map<string, Uint8Array>()
  let total = 0
  for (let i = 0; i < count; i++) {
    if (at + 46 > data.length || v.getUint32(at, true) !== 0x02014b50) throw bad()
    const flags = v.getUint16(at + 8, true)
    const method = v.getUint16(at + 10, true)
    const crc = v.getUint32(at + 16, true)
    const packed = v.getUint32(at + 20, true)
    const size = v.getUint32(at + 24, true)
    const nameLen = v.getUint16(at + 28, true)
    const extra = v.getUint16(at + 30, true) + v.getUint16(at + 32, true)
    const local = v.getUint32(at + 42, true)
    const name = new TextDecoder().decode(data.subarray(at + 46, at + 46 + nameLen))
    at += 46 + nameLen + extra
    if (name.endsWith('/')) continue
    if (flags & 1) throw new UserError('This file is password protected. Remove the password in the program that made it, then try again.')
    if (size > lim.maxEntryBytes || (total += size) > lim.maxTotalBytes) throw new UserError('This file expands to more than the size limit.')
    if (local + 30 > data.length || v.getUint32(local, true) !== 0x04034b50) throw bad()
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    if (start + packed > data.length) throw bad()
    const raw = data.subarray(start, start + packed)
    let bytes: Uint8Array | null
    if (method === 0) bytes = raw
    else if (method === 8) {
      try {
        bytes = await inflateRaw(raw, size)
      } catch {
        throw bad()
      }
    } else throw new UserError('This file uses a compression method that is not supported.')
    // a lying size field would otherwise let a bomb through; the stream was capped at the declared size
    if (!bytes || bytes.length !== size || crc32(bytes) !== crc) throw bad()
    out.set(name, bytes)
  }
  return out
}
