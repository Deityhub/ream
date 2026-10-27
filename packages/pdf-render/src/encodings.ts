// Single-byte text encodings and glyph names, enough to turn the character codes of a simple font into Unicode.

const ascii = (): string[] => Array.from({ length: 128 }, (_, i) => (i >= 32 && i < 127 ? String.fromCharCode(i) : ''))

// WinAnsi is Windows-1252; the codes it leaves undefined show as a bullet
const CP1252_80 = ['€', '•', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '•', 'Ž', '•', '•', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '•', 'ž', 'Ÿ']

export const winAnsi: string[] = [
  ...ascii(),
  ...CP1252_80,
  ' ', ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(0xa1 + i)),
]
winAnsi[127] = '•'
winAnsi[0xad] = '-' // soft hyphen

// MacRoman 0x80-0xFF as PDF defines it (currency at 0xDB, no Apple logo at 0xF0)
const MAC_HIGH =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄¤‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ'
export const macRoman: string[] = [...ascii(), ...Array.from(MAC_HIGH)]

// StandardEncoding (the Type 1 default): ASCII with curly quotes in place of ' and `, and Latin extras above 0xA0
const STANDARD_HIGH: Record<number, string> = {
  0xa1: '¡', 0xa2: '¢', 0xa3: '£', 0xa4: '⁄', 0xa5: '¥', 0xa6: 'ƒ', 0xa7: '§', 0xa8: '¤', 0xa9: "'", 0xaa: '“', 0xab: '«', 0xac: '‹', 0xad: '›', 0xae: 'ﬁ', 0xaf: 'ﬂ',
  0xb1: '–', 0xb2: '†', 0xb3: '‡', 0xb4: '·', 0xb6: '¶', 0xb7: '•', 0xb8: '‚', 0xb9: '„', 0xba: '”', 0xbb: '»', 0xbc: '…', 0xbd: '‰', 0xbf: '¿',
  0xc1: '`', 0xc2: '´', 0xc3: 'ˆ', 0xc4: '˜', 0xc5: '¯', 0xc6: '˘', 0xc7: '˙', 0xc8: '¨', 0xca: '˚', 0xcb: '¸', 0xcd: '˝', 0xce: '˛', 0xcf: 'ˇ',
  0xd0: '—', 0xe1: 'Æ', 0xe3: 'ª', 0xe8: 'Ł', 0xe9: 'Ø', 0xea: 'Œ', 0xeb: 'º', 0xf1: 'æ', 0xf5: 'ı', 0xf8: 'ł', 0xf9: 'ø', 0xfa: 'œ', 0xfb: 'ß',
}
export const standard: string[] = ascii().concat(Array.from({ length: 128 }, (_, i) => STANDARD_HIGH[128 + i] ?? ''))
standard[0x27] = '’'
standard[0x60] = '‘'

export const baseEncodings: Record<string, string[]> = {
  WinAnsiEncoding: winAnsi,
  MacRomanEncoding: macRoman,
  StandardEncoding: standard,
}

// ---------- glyph names ----------

const NAMES: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '’',
  parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', colon: ':', semicolon: ';',
  less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^',
  underscore: '_', grave: '`', quoteleft: '‘', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~', exclamdown: '¡', cent: '¢',
  sterling: '£', currency: '¤', yen: '¥', brokenbar: '¦', section: '§', dieresis: '¨', copyright: '©', ordfeminine: 'ª', guillemotleft: '«',
  logicalnot: '¬', registered: '®', macron: '¯', degree: '°', plusminus: '±', twosuperior: '²', threesuperior: '³', acute: '´', mu: 'µ',
  paragraph: '¶', periodcentered: '·', cedilla: '¸', onesuperior: '¹', ordmasculine: 'º', guillemotright: '»', onequarter: '¼',
  onehalf: '½', threequarters: '¾', questiondown: '¿', multiply: '×', divide: '÷', endash: '–', emdash: '—', quotedblleft: '“',
  quotedblright: '”', quotesinglbase: '‚', quotedblbase: '„', dagger: '†', daggerdbl: '‡', bullet: '•', ellipsis: '…', perthousand: '‰',
  guilsinglleft: '‹', guilsinglright: '›', fi: 'ﬁ', fl: 'ﬂ', florin: 'ƒ', fraction: '⁄', trademark: '™', Euro: '€', minus: '−',
  circumflex: 'ˆ', tilde: '˜', breve: '˘', dotaccent: '˙', ring: '˚', hungarumlaut: '˝', ogonek: '˛', caron: 'ˇ', dotlessi: 'ı',
  AE: 'Æ', ae: 'æ', OE: 'Œ', oe: 'œ', Oslash: 'Ø', oslash: 'ø', Lslash: 'Ł', lslash: 'ł', germandbls: 'ß', Eth: 'Ð', eth: 'ð', Thorn: 'Þ',
  thorn: 'þ', nbspace: ' ', nonbreakingspace: ' ', softhyphen: '-', sfthyphen: '-', ff: 'ﬀ', ffi: 'ﬃ', ffl: 'ﬄ', lozenge: '◊',
  summation: '∑', radical: '√', infinity: '∞', notequal: '≠', lessequal: '≤', greaterequal: '≥', approxequal: '≈', partialdiff: '∂',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
}
const ACCENTS: Record<string, string> = {
  acute: '́', grave: '̀', circumflex: '̂', tilde: '̃', dieresis: '̈', ring: '̊', cedilla: '̧',
  caron: '̌', macron: '̄', breve: '̆', ogonek: '̨', dotaccent: '̇', hungarumlaut: '̋',
}

/** Unicode text for a glyph name (Adobe Glyph List conventions), or undefined when we can't tell */
export function glyphToUnicode(name: string): string | undefined {
  if (name in NAMES) return NAMES[name]
  const base = name.split('.')[0] // "a.sc", "f_i" style variants
  if (base !== name) return glyphToUnicode(base)
  if (/^[A-Za-z]$/.test(name)) return name
  let m = /^uni([0-9A-Fa-f]{4})+$/.exec(name)
  if (m) return String.fromCharCode(...(name.slice(3).match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)))
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name)
  if (m) return String.fromCodePoint(parseInt(m[1], 16))
  m = /^([A-Za-z])(acute|grave|circumflex|tilde|dieresis|ring|cedilla|caron|macron|breve|ogonek|dotaccent|hungarumlaut)$/.exec(name)
  if (m) return (m[1] + ACCENTS[m[2]]).normalize('NFC')
  if (name.includes('_')) {
    const parts = name.split('_').map(glyphToUnicode)
    if (parts.every((p) => p !== undefined)) return parts.join('')
  }
  return undefined
}
