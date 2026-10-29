import type { ToolSeo } from './types.ts'

export const pdfSeo: Record<string, ToolSeo> = {
  'merge-pdf': {
    title: 'Merge PDF files online, free and private | Ream',
    description: 'Combine several PDFs into one file in your browser. Set the order and keep bookmarks and form fields. Nothing is uploaded.',
    intro: 'Join two or more PDFs into a single document. Add the files, put them in the order you want with the arrows, and download one merged PDF. Ream does the work on your own device, so your documents are never uploaded.',
    points: ['Add as many PDFs as you need and move them up or down to set the order', 'Keeps bookmarks, links and form fields from the files you combine', 'Asks for the password of a protected file instead of failing'],
    faq: [
      ['Is there a limit on how many PDFs I can merge?', 'Up to 50 files at a time, 200 MB each and 500 MB in all. For more than that, merge in two rounds.'],
      ['Can I merge only some pages of a PDF?', 'Not in this tool. Use Split PDF or Organize pages to make the pages you want first, then merge the results.'],
    ],
  },
  'split-pdf': {
    title: 'Split a PDF into pages or ranges online | Ream',
    description: 'Split a PDF by page ranges like 1-3,5, or into a new file every few pages. It runs in your browser and nothing is uploaded.',
    intro: 'Cut a PDF into smaller files. Type the page ranges you want, such as 1-3,5, or choose a new file every few pages. When the result has several files, they download together in one ZIP.',
    points: ['Ranges such as 1-3,5-8 make one file each', 'Or start a new file every 1, 2, 5 or any number of pages', 'Pages keep their text, pictures and size exactly as they were'],
    faq: [
      ['What do the page ranges mean?', '1-3 is pages one to three. A comma starts the next file, so 1-3,5 gives one file with pages 1 to 3 and another with page 5.'],
      ['Can I extract just one page?', 'Yes. Enter that page number as the range, for example 7, and download the one-page PDF.'],
    ],
  },
  'compress-pdf': {
    title: 'Compress PDF online, free and private | Ream',
    description: 'Make a PDF smaller without losing its text. Pick lossless, balanced or small, and see the new size before you save.',
    intro: 'Reduce the size of a PDF so it is easier to email or upload. Ream repacks the file and, at the balanced and small levels, brings large pictures down to the resolution they are shown at. Text stays text, so it remains sharp and searchable.',
    points: ['Three levels: lossless, balanced (pictures at 150 dpi) and small (96 dpi)', 'The new size is shown while you choose, before you download', 'A file that cannot get smaller is returned as it was'],
    faq: [
      ['Will compressing hurt the quality?', 'Lossless keeps every picture exactly and only repacks the file. Balanced and small lower the resolution and quality of photographs, which is where most of the saving is. Text and line drawings stay sharp.'],
      ['Why did my PDF barely shrink?', 'A PDF that is mostly text, or whose pictures are already small, has little left to save. Ream then keeps your original rather than making a larger file.'],
    ],
  },
  watermark: {
    title: 'Add a text watermark to a PDF online | Ream',
    description: 'Stamp text such as CONFIDENTIAL across the pages of a PDF. Set size, colour, opacity, angle and position. Runs in your browser.',
    intro: 'Put a line of text over, or behind, the pages of a PDF: a status like DRAFT, a name, a notice. Choose the font, size, colour, opacity and angle, place it once per page or tile it, and pick which pages get it.',
    points: ['Over or behind the content of each page', 'One mark per page, or repeated across it', 'Use your own font file for any alphabet or brand'],
    faq: [
      ['Can a watermark be taken off again?', 'It is drawn into the pages of the new file, so someone with a PDF editor could cover or remove it. To hide information for good, use Redact PDF.'],
      ['Can I watermark only some pages?', 'Yes. Enter the pages, such as 1-3, 5, or leave it empty to mark them all.'],
    ],
  },
  'page-numbers': {
    title: 'Add page numbers to a PDF online | Ream',
    description: 'Number the pages of a PDF as 1, Page 1, 1 of 10 or Page 1 of 10. Choose the corner, size and colour, and skip a cover.',
    intro: 'Add page numbers to a PDF that has none. Pick a style, one of six places on the page, a start number and the first page to number, so a cover can stay blank. The numbers are stamped onto each page of a new copy.',
    points: ['Four styles: 1, Page 1, 1 of N and Page 1 of N', 'Top or bottom, left, centre or right', 'Start from any page, with any starting number'],
    faq: [
      ['Can I leave the cover without a number?', 'Yes. Choose the page to start numbering from and the pages before it stay blank.'],
      ['Do the numbers sit correctly on rotated pages?', 'Yes. They are placed as the page is displayed, so they appear in the chosen corner of landscape and rotated pages too.'],
    ],
  },
  'crop-pdf': {
    title: 'Crop PDF pages online, free and private | Ream',
    description: 'Drag to choose the area of a PDF page to keep, for one page or all of them. Delete the rest for good, or just hide it.',
    intro: 'Trim margins or cut a page down to the part you need. Drag a rectangle on the page, apply it to every page or give each page its own area, and decide whether the cropped-out part is deleted from the file or only hidden.',
    points: ['Draw the area on the page itself, at any zoom', 'One area for all pages, or a different one for each page', 'Delete what is cropped away, or only hide it'],
    faq: [
      ['Is the cropped-out part really gone?', 'With Delete them chosen, text, pictures and lines that lie entirely outside the selection are removed from the file. Just hide them only makes the page smaller; the edges stay in the file.'],
      ['Can I crop different pages differently?', 'Yes. Switch to a separate selection for each page, and pages without one are left as they are.'],
    ],
  },
  'redact-pdf': {
    title: 'Redact PDF: remove text and images for good | Ream',
    description: 'Remove sensitive text, pictures and lines from a PDF permanently, not just cover them. Runs on your device; nothing is uploaded.',
    intro: 'Mark areas of a page and Ream removes what is under them from the file: the text itself, the parts of pictures and the lines, not only a black box drawn on top. It can also clear document properties and hidden data. Everything happens on your device.',
    points: ['Draw boxes on any page, or the same boxes on every page', 'Text, picture pixels and lines under a box are taken out, so they cannot be copied', 'Optionally clears properties, metadata, thumbnails and private data'],
    faq: [
      ['Is redaction permanent?', 'Yes for what is under the boxes: the text and picture data are removed from the new file, so copying, searching or opening it in another tool finds nothing there. Keep your original safe, because the redacted copy cannot be undone.'],
      ['Can it find words to redact automatically?', 'Not at the moment. You mark the areas yourself.'],
    ],
  },
  'fill-pdf-form': {
    title: 'Fill in PDF forms online, free and private | Ream',
    description: 'Type into the fields of a PDF form, tick boxes and choose from lists, then save. Optionally lock the answers. No upload.',
    intro: 'Open a PDF form, type into its fields, tick the boxes and pick from the lists, then download the filled copy. If you want the answers to be final, lock them so they become part of the page and can no longer be edited.',
    points: ['Text fields, check boxes, radio buttons and choice lists', 'Fields keep their limits, such as a maximum length', 'Lock the answers to make them permanent'],
    faq: [
      ['Does it work with every PDF form?', 'It fills standard PDF forms (AcroForm), the usual kind. Forms built with XFA, a rare Adobe-specific format, are not supported.'],
      ['What does locking the answers do?', 'It draws the answers onto the page and removes the fields, so the file looks the same everywhere and nobody can change what you typed.'],
    ],
  },
  'edit-pdf': {
    title: 'Edit PDF online: add text, images and shapes | Ream',
    description: 'Add text, pictures, shapes, drawings, highlights, comments and form fields to a PDF, or change what is already on the page.',
    intro: 'A PDF editor that runs in your browser. Add text and pictures, draw shapes and freehand lines, highlight or underline text, leave comments and create form fields. You can also change or delete the lines of text and pictures already on a page, and erase areas.',
    points: ['Add text, pictures, shapes, drawings and links', 'Highlight, underline, strike out and comment on text', 'Change or remove the page\'s own text and pictures, with undo'],
    faq: [
      ['Can I change the text that is already in my PDF?', 'Pick a line and change or delete it. If the file\'s own font does not have a letter you type, Ream uses a similar font for that line.'],
      ['Can I edit a scanned PDF?', 'A scan is a picture of a page, so you can cover, erase or add to it, but its words are not text and cannot be changed. Ream has no text recognition (OCR).'],
    ],
  },
  metadata: {
    title: 'Edit PDF metadata: title, author, keywords | Ream',
    description: 'Change the title, author, subject and keywords stored in a PDF file. Runs in your browser; nothing is uploaded.',
    intro: 'Every PDF carries properties that readers show in the title bar and the file info: title, author, subject and keywords. See what yours says, change or empty them, then download the updated file. Your original is left untouched.',
    points: ['Edit the title, author, subject and keywords', 'See what the file says now before you share it', 'Download an updated copy and keep your original'],
    faq: [
      ['Why edit a PDF\'s metadata?', 'The title shows in browser tabs and search results, and the author can reveal who made a file or which program they used. Setting or clearing them before you share a PDF avoids surprises.'],
      ['Does it change the pages?', 'No. The pages, text and pictures are carried into the new file unchanged.'],
    ],
  },
  'extract-images': {
    title: 'Extract images from a PDF online | Ream',
    description: 'Save the pictures inside a PDF as separate image files. Skip tiny icons with a size filter. Nothing leaves your device.',
    intro: 'Pull the photographs and graphics out of a PDF. Ream finds every picture stored in the file, saves each as an image, and gives them to you together in a ZIP. A minimum size setting skips icons, bullets and thin rules.',
    points: ['Finds pictures on the pages and inside nested content', 'Skips tiny pictures with a minimum size', 'Everything arrives together in one ZIP'],
    faq: [
      ['Does it take a screenshot of each page?', 'No. It extracts the pictures that are stored in the file. To save whole pages as images, use PDF to image.'],
      ['Why did it find fewer pictures than I see?', 'Charts and drawings are made of lines and shapes, not pictures, so there is nothing to extract from them. PDF to image saves how a page looks.'],
    ],
  },
  'protect-pdf': {
    title: 'Password protect a PDF online, with AES | Ream',
    description: 'Lock a PDF with a password using AES-256 encryption, and choose whether printing, copying and editing are allowed.',
    intro: 'Add a password so that only people who know it can open your PDF. Ream encrypts the file with AES-256 on your device, and you can also restrict printing, copying text and editing. The password is never sent anywhere.',
    points: ['AES-256, or AES-128 for very old readers', 'Type the password twice to catch a slip', 'Optionally restrict printing, copying and changes'],
    faq: [
      ['Can I get the file back if I forget the password?', 'No. The password is not stored anywhere, not even by Ream, and a strong one cannot be guessed. Keep it somewhere safe.'],
      ['How safe is the protection?', 'AES-256 is the strongest encryption PDF supports. Restrictions on printing or copying are a request that most readers follow, but a determined person can remove them. The password to open the file is what really protects it.'],
    ],
  },
  'unlock-pdf': {
    title: 'Unlock a PDF: remove its password online | Ream',
    description: 'Remove the password and the restrictions from a PDF you know the password of. Runs in your browser; nothing is uploaded.',
    intro: 'Save a copy of a protected PDF that opens without a password and allows printing, copying and editing. You enter the password you were given, Ream decrypts the file on your device and writes it out unprotected.',
    points: ['Works with the password to open and the owner password', 'Removes limits on printing, copying and editing', 'Needs the password: it does not guess or crack them'],
    faq: [
      ['Can it unlock a PDF if I forgot the password?', 'No. Ream needs the password and does not try to break passwords. A file that opens freely but blocks printing or copying needs no password to unlock.'],
      ['Is it all right to remove the protection?', 'Only from files you are allowed to change. A password or a restriction often reflects someone\'s wishes about the document.'],
    ],
  },
  'sign-pdf': {
    title: 'Sign a PDF online: draw or type your signature | Ream',
    description: 'Draw, type or upload your signature and place it on a PDF page. Runs on your device, so the document is never uploaded.',
    intro: 'Add your signature to a PDF without printing it. Draw it with a mouse or finger, type your name in a handwriting font, or upload a picture of your signature, then drag it into place on the last page, one page or every page.',
    points: ['Draw, type or upload a signature', 'Drag and resize it on the page', 'Sign the last page, a chosen page or all of them'],
    faq: [
      ['Is this a legally binding digital signature?', 'It places a picture of your signature on the page, like signing on paper. It is not a certificate-based digital signature, which proves who signed and detects later changes. Ask the recipient which kind they need.'],
      ['Is my signature stored?', 'No. It exists only in the page while you work, and in the PDF you download.'],
    ],
  },
  'organize-pdf': {
    title: 'Organize PDF pages: reorder, rotate, delete | Ream',
    description: 'See every page as a thumbnail, then reorder, rotate, copy or delete pages and save the result as a new PDF.',
    intro: 'Rearrange a PDF visually. Every page is shown as a thumbnail you can move earlier or later, turn left or right, copy or delete. When it looks right, download the new file.',
    points: ['Move pages to a new place', 'Turn single pages left or right', 'Copy a page to use it twice, or delete the ones you do not need'],
    faq: [
      ['Do the pages lose quality?', 'No. Pages are carried into the new file as they are, not redrawn as pictures.'],
      ['Can I use pages from several PDFs?', 'Not in this tool. Merge the files first with Merge PDF, then organise the result.'],
    ],
  },
  'bookmarks-pdf': {
    title: 'Add and edit PDF bookmarks online | Ream',
    description: 'Add, rename and reorder the bookmarks (outline) of a PDF so readers can jump to sections. Nothing is uploaded.',
    intro: 'Bookmarks appear in the side panel of a PDF reader and let people jump to a section. See the ones a file has, rename or reorder them, add new ones that point to a page, and save the updated PDF.',
    points: ['Add a bookmark for any page', 'Rename them and put them in order', 'See the bookmarks the file already has'],
    faq: [
      ['What is a PDF bookmark?', 'An entry in the outline that readers show beside the pages. Clicking it jumps to a page. Long reports and books use them as a table of contents.'],
      ['Will my existing bookmarks be kept?', 'Yes. Ream reads them from the file, and you change what you want.'],
    ],
  },
  'repair-pdf': {
    title: 'Repair a damaged PDF online | Ream',
    description: 'Recover a PDF that will not open or shows errors, and save a clean copy. Runs in your browser; nothing is uploaded.',
    intro: 'Some PDFs break when a download is cut short or a program writes them badly. Ream reads what is still there, rebuilds the index of the file and writes a clean copy that opens normally, whenever the pages can be found.',
    points: ['Rebuilds a broken index of the file', 'Writes a clean, tidy copy', 'Says so when there is nothing it can recover'],
    faq: [
      ['Will it recover everything?', 'It recovers what is still in the file. If the damaged part held pages or pictures, those cannot be brought back.'],
      ['How do I know the repair worked?', 'The preview shows the pages of the repaired file. If they look right, download it.'],
    ],
  },
  'pdf-to-text': {
    title: 'Convert PDF to text or Markdown online | Ream',
    description: 'Get the text out of a PDF as plain text or Markdown, in reading order. Runs in your browser; nothing is uploaded.',
    intro: 'Copy the text of a PDF without selecting it page by page. Choose plain text or Markdown and Ream reads each page in reading order, handling columns, and gives you one file.',
    points: ['Plain text or Markdown', 'Text is read in order, including pages with columns', 'Preview the result before you download'],
    faq: [
      ['Does it work on scanned PDFs?', 'Only if the PDF contains real text. A scan is a picture of a page, and Ream has no text recognition (OCR) yet, so it finds no text in it.'],
      ['Will the text match what I see?', 'Mostly. Reading order is worked out from where the text sits on the page, which is a good guess for ordinary documents and less certain for unusual layouts.'],
    ],
  },
}
