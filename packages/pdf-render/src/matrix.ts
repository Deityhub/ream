/** [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f (the same layout PDF and canvas use) */
export type Matrix = [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** the transform "m first, then n" (PDF's  m x n  with row vectors) */
export const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
]

export const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** how much the matrix scales lengths, on average */
export const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))

/**
 * Maps PDF user space to device pixels for a page: origin at the box's lower-left, y flipped, scaled, then turned
 * by the page's /Rotate. `box` is [llx, lly, urx, ury], `rotate` a multiple of 90.
 */
export function pageMatrix(box: [number, number, number, number], rotate: number, s: number): Matrix {
  const [llx, lly, urx, ury] = box
  switch ((((Math.round(rotate / 90) % 4) + 4) % 4) * 90) {
    case 90:
      return [0, s, s, 0, -s * lly, -s * llx]
    case 180:
      return [-s, 0, 0, s, s * urx, -s * lly]
    case 270:
      return [0, -s, -s, 0, s * ury, s * urx]
    default:
      return [s, 0, 0, -s, -s * llx, s * ury]
  }
}
