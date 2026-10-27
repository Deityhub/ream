// Dev CLI for trying pdf-core on real files:  yarn pdf <command> ...   (see usage below)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PdfDocument, chunks, decryptPdf, extract, isName, merge, flattenPdf, optimize, parseRanges, readForm, readOutline, remove, repairPdf, rotate, split } from '../packages/pdf-core/src/index.ts'
import { extractText } from '../packages/pdf-render/src/index.ts'

const usage = `usage:
  yarn pdf info <in.pdf>
  yarn pdf merge <a.pdf> <b.pdf> ... -o <out.pdf>
  yarn pdf extract <in.pdf> <pages> -o <out.pdf>      pages like 1-3,5,8-
  yarn pdf remove  <in.pdf> <pages> -o <out.pdf>
  yarn pdf rotate  <in.pdf> <90|180|270|-90> [pages] -o <out.pdf>
  yarn pdf split   <in.pdf> <pages | every:N> -o <outdir>   one file per comma item
  yarn pdf decrypt <in.pdf> -p <password> -o <out.pdf>
  yarn pdf optimize <in.pdf> -o <out.pdf>        the lossless part of Compress PDF (no picture changes)
  yarn pdf repair  <in.pdf> -o <out.pdf>         rebuild a damaged file
  yarn pdf flatten <in.pdf> -o <out.pdf>         bake form fields and comments into the pages
  yarn pdf text    <in.pdf> [md] [-o <out.txt>]   extract the text (prints it without -o)
  yarn pdf form    <in.pdf>                      list the form fields and bookmarks

Add -p <password> to any command to open a password protected PDF.`

const argv = process.argv.slice(2)
const flag = (name: string) => {
  const at = argv.indexOf(name)
  return at >= 0 ? argv[at + 1] : undefined
}
const out = flag('-o')
const password = flag('-p') ?? ''
const args = argv.filter((a, i) => !['-o', '-p'].includes(a) && !['-o', '-p'].includes(argv[i - 1]))
const load = (path: string) => PdfDocument.load(new Uint8Array(readFileSync(path)), { password })
const [cmd, ...rest] = args

function need(v: string | undefined, what: string): string {
  if (!v) throw new Error(`missing ${what}\n${usage}`)
  return v
}
const save = (bytes: Uint8Array) => {
  writeFileSync(need(out, '-o <out.pdf>'), bytes)
  console.log(`wrote ${out} (${bytes.length} bytes)`)
}

try {
  if (cmd === 'info') {
    const doc = await load(need(rest[0], 'input file'))
    const pages = doc.pages()
    console.log(`${pages.length} pages, ${doc.objects.size} objects`)
    pages.forEach((p, i) => {
      const box = doc.resolve(p.dict.get('MediaBox') ?? p.inherited.get('MediaBox'))
      const rot = doc.resolve(p.dict.get('Rotate') ?? p.inherited.get('Rotate')) ?? 0
      console.log(`  ${i + 1}: MediaBox ${JSON.stringify(box)} rotate ${rot}${isName(p.dict.get('Type'), 'Page') ? '' : ' (untyped)'}`)
    })
  } else if (cmd === 'repair') {
    const r = await repairPdf(new Uint8Array(readFileSync(need(rest[0], 'input file'))), { password })
    console.log(`${r.pages} pages${r.rebuilt ? ', index rebuilt' : ''}${r.treeFixed ? ', page tree rebuilt' : ''}`)
    save(r.bytes)
  } else if (cmd === 'flatten') {
    const r = await flattenPdf(await load(need(rest[0], 'input file')), { forms: true, comments: true })
    console.log(`${r.flattened} flattened`)
    save(r.bytes)
  } else if (cmd === 'text') {
    const doc = await load(need(rest[0], 'input file'))
    const text = (await extractText(doc, doc.pages().map((_, i) => i), { markdown: rest[1] === 'md' })).join('\n\n')
    if (out) writeFileSync(out, text + '\n')
    else console.log(text)
  } else if (cmd === 'form') {
    const doc = await load(need(rest[0], 'input file'))
    for (const f of readForm(doc).fields) console.log(`${f.name} [${f.kind}] = ${JSON.stringify(f.value)}${f.page === null ? '' : ` (page ${f.page + 1})`}`)
    const walk = (items: ReturnType<typeof readOutline>, depth = 0) => items.forEach((i) => (console.log(`${'  '.repeat(depth)}- ${i.title} -> ${i.page === null ? '-' : i.page + 1}`), walk(i.children, depth + 1)))
    walk(readOutline(doc))
  } else if (cmd === 'optimize') {
    save(await optimize(await load(need(rest[0], 'input file'))))
  } else if (cmd === 'decrypt') {
    save(await decryptPdf(new Uint8Array(readFileSync(need(rest[0], 'input file'))), password))
  } else if (cmd === 'merge') {
    save(merge(await Promise.all(rest.map(async (f) => ({ doc: await load(f) })))))
  } else if (cmd === 'extract' || cmd === 'remove') {
    const doc = await load(need(rest[0], 'input file'))
    const pages = parseRanges(need(rest[1], 'pages'), doc.pages().length).flat()
    save(cmd === 'extract' ? extract(doc, pages) : remove(doc, pages))
  } else if (cmd === 'rotate') {
    const doc = await load(need(rest[0], 'input file'))
    const pages = rest[2] ? parseRanges(rest[2], doc.pages().length).flat() : undefined
    save(rotate(doc, Number(need(rest[1], 'angle')), pages))
  } else if (cmd === 'split') {
    const file = need(rest[0], 'input file')
    const doc = await load(file)
    const spec = need(rest[1], 'pages or every:N')
    const count = doc.pages().length
    const groups = spec.startsWith('every:') ? chunks(count, Number(spec.slice(6))) : parseRanges(spec, count)
    const dir = need(out, '-o <outdir>')
    mkdirSync(dir, { recursive: true })
    split(doc, groups).forEach((bytes, i) => {
      const path = join(dir, `${basename(file, '.pdf')}-${i + 1}.pdf`)
      writeFileSync(path, bytes)
      console.log(`wrote ${path} (${groups[i].length} pages)`)
    })
  } else {
    console.log(usage)
    process.exitCode = cmd ? 1 : 0
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
}
