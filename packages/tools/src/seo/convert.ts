import type { ToolSeo } from './types.ts'

export const convertSeo: Record<string, ToolSeo> = {
  'images-to-pdf': {
    title: 'Convert images to PDF online (JPG, PNG) | Ream',
    description: 'Turn JPG, PNG, WebP, GIF and BMP pictures into one PDF. Choose the page size, orientation and margin. Nothing is uploaded.',
    intro: 'Put pictures into a single PDF, one per page, in the order you set. Make each page the size of its picture or pick A4, US Letter and other sizes, with the orientation and margin you want. JPEG photos go in as they are, so they are not recompressed.',
    points: ['JPG, PNG, WebP, GIF and BMP pictures', 'Pages as big as the picture, or A3, A4, A5, US Letter, Legal and more', 'Put the pictures in order and set the margin and orientation'],
    faq: [
      ['Does it reduce the quality of my photos?', 'No. JPEG photos are placed in the PDF exactly as they are, without recompressing them. Other pictures are stored without further loss of detail.'],
      ['Can I combine the result with other PDFs?', 'Yes. Make the PDF here, then join it with other files in Merge PDF.'],
    ],
  },
  'pdf-to-image': {
    title: 'Convert PDF to JPG or PNG images online | Ream',
    description: 'Save PDF pages as PNG or JPG pictures at 36 to 600 dpi. Pick the pages you want. Runs on your device; nothing is uploaded.',
    intro: 'Turn pages of a PDF into pictures you can post, paste into a document or send. Choose PNG for sharp text and graphics or JPG for smaller photographs, a resolution from 36 to 600 dpi, and which pages. Several pages download together as a ZIP.',
    points: ['PNG, or JPG with a quality setting', 'From 36 to 600 dots per inch', 'All pages, or a selection such as 1-3, 5'],
    faq: [
      ['Which format should I choose?', 'PNG keeps text and line art crisp and is the better choice for most pages. JPG makes smaller files for pages that are mostly photographs.'],
      ['Why was my result refused as too large?', 'A big page at 600 dpi can need more pixels than a browser can hold. Ream says so before it draws anything; lower the resolution or choose fewer pages.'],
    ],
  },
  'pdf-to-word': {
    title: 'Convert PDF to Word (DOCX) online | Ream',
    description: 'Turn a PDF into an editable Word document. The text becomes real text you can edit, and the page design is kept.',
    intro: 'Get an editable .docx from a PDF without sending the file to a converter. Ream keeps the artwork of each page as a picture and puts the text on top as editable text boxes, so the document looks like the original and you can still change the words.',
    points: ['The text is real text you can edit and search', 'The page\'s artwork, pictures and shapes are kept', 'Every page of the PDF becomes a page of the document'],
    faq: [
      ['Will the result look exactly like the PDF?', 'Close, not identical. Text is placed in boxes over the page\'s artwork, so fonts and line breaks can differ a little. It is a good starting point for editing, not a pixel-perfect copy.'],
      ['Can it convert a scanned PDF?', 'No. A scan has no text to put in the document, only a picture of it, and Ream has no text recognition (OCR) yet.'],
    ],
  },
  'pdf-to-excel': {
    title: 'Convert PDF tables to Excel (XLSX) online | Ream',
    description: 'Get the tables in a PDF into an Excel workbook. Finds tables drawn with lines and text lined up in columns. No upload.',
    intro: 'Pull tables out of a PDF report, invoice or statement and into an .xlsx file you can sort and calculate with. Ream looks for tables drawn with ruled lines and for text that lines up in columns, and writes the cells into a workbook.',
    points: ['Finds tables with ruled lines and tables made of aligned text', 'Numbers in the cells become numbers where they can be read', 'Preview the workbook before you download it'],
    faq: [
      ['What happens if no table is found?', 'Ream tells you instead of giving you an empty file. Text set in ordinary paragraphs is not a table; PDF to text is the better tool for it.'],
      ['Does it read tables in scanned PDFs?', 'No. It needs the real text in the PDF, and Ream has no text recognition (OCR) yet.'],
    ],
  },
  'pdf-to-powerpoint': {
    title: 'Convert PDF to PowerPoint (PPTX) online | Ream',
    description: 'Turn the pages of a PDF into slides you can edit: the design is kept and the text becomes real, editable text boxes.',
    intro: 'Make a presentation out of a PDF. Each page becomes a slide, with the page\'s artwork kept in the background and its text placed on top as text boxes you can edit and move.',
    points: ['One slide for every page', 'Editable text boxes over the page\'s artwork', 'Preview the slides before you download'],
    faq: [
      ['Will the slides match the PDF exactly?', 'They look close to the PDF. Text is placed as lines in text boxes, so fonts and spacing can differ a little. Treat it as an editable starting point.'],
      ['Does it work with scanned PDFs?', 'No. A scan has no text to place on the slides, and Ream has no text recognition (OCR) yet.'],
    ],
  },
  'excel-to-pdf': {
    title: 'Convert Excel (XLSX) to PDF online | Ream',
    description: 'Print an Excel workbook to PDF with its formatting, merged cells, pictures and charts. Runs in your browser; nothing is uploaded.',
    intro: 'Save a workbook as a PDF without opening Excel. Ream reads the .xlsx file and lays each sheet out the way it prints, with fonts, colours, borders, number formats and charts. A preview shows the result before you download.',
    points: ['Keeps formatting, merged cells, pictures and charts', 'Uses the page setup and print areas saved in the workbook', 'Fonts: your installed ones, look-alikes, or ones you add'],
    faq: [
      ['Will it look the same as in Excel?', 'Close, not identical. Ream draws the sheet itself and uses look-alike fonts when yours are not available, so line breaks and chart details can differ slightly. The preview is marked approximate for that reason.'],
      ['Does it work with older .xls files?', 'Only .xlsx files. Save an older workbook as .xlsx first. Formulas show the results saved in the file; Ream does not recalculate them.'],
    ],
  },
  'powerpoint-to-pdf': {
    title: 'Convert PowerPoint (PPTX) to PDF online | Ream',
    description: 'Save a presentation as a PDF with one page per slide, including shapes, tables, pictures and charts. Nothing is uploaded.',
    intro: 'Turn a .pptx into a PDF to share or print, without opening PowerPoint. Ream reads the slides, layouts and theme and draws each slide as a page, with its text, shapes, tables, pictures and charts.',
    points: ['One PDF page for every slide', 'Themes, layouts, shapes, tables, pictures and charts', 'Fonts: your installed ones, look-alikes, or ones you add'],
    faq: [
      ['Are animations and transitions kept?', 'No. A PDF holds still pages, so each slide is saved as it appears before any animation.'],
      ['Will it match PowerPoint exactly?', 'Close, not identical. Ream draws the slides itself, so unusual effects and some fonts can differ. The preview is marked approximate for that reason.'],
    ],
  },
}
