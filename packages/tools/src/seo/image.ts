import type { ToolSeo } from './types.ts'

export const imageSeo: Record<string, ToolSeo> = {
  'resize-image': {
    title: 'Resize images online: pixels or percent | Ream',
    description: 'Change the size of JPG, PNG, WebP, GIF and BMP pictures by pixels or percent, one or many at once. Nothing is uploaded.',
    intro: 'Make pictures bigger or smaller. Type a width, a height or both in pixels, or scale by a percentage, and keep the proportions if you want. Add many pictures and they are all resized the same way, then downloaded together.',
    points: ['Set the size in pixels, or as a percentage', 'Keep the aspect ratio, or set both sides', 'Resize many pictures in one go'],
    faq: [
      ['Does resizing reduce the quality?', 'Making a picture smaller keeps it sharp, because Ream resamples it with a high-quality filter. Enlarging cannot add detail, so large enlargements look soft.'],
      ['How big a picture can it handle?', 'Up to about 120 megapixels, which covers any phone or camera photo.'],
    ],
  },
  'convert-image': {
    title: 'Convert images: JPG, PNG, WebP, GIF, BMP | Ream',
    description: 'Change pictures between PNG, JPG, WebP, GIF and BMP with a quality setting. Many files at once, on your device.',
    intro: 'Save pictures in another format: PNG for sharp graphics, JPG for photographs, WebP for small files on the web, GIF or BMP when something needs them. Add one picture or many, and choose a quality for JPG and WebP.',
    points: ['PNG, JPG, WebP, GIF and BMP in and out', 'A quality setting for JPG and WebP', 'Transparent areas turn white when you save as JPG'],
    faq: [
      ['Can I convert HEIC or RAW photos?', 'Not yet. Ream opens JPG, PNG, WebP, GIF and BMP.'],
      ['Does converting to JPG lose quality?', 'JPG is a lossy format, so a little detail is lost each time one is saved. Use a high quality setting to lose less, or PNG when nothing may be lost.'],
    ],
  },
  'rotate-image': {
    title: 'Rotate and flip images online | Ream',
    description: 'Turn pictures a quarter or half turn, or mirror them left to right or top to bottom. Many at once, on your device.',
    intro: 'Fix a sideways photo or mirror a picture. Turn it a quarter turn either way or a half turn, flip it horizontally or vertically, and see the result before you save. Several pictures can be done together.',
    points: ['Quarter turns and half turns', 'Flip left to right or top to bottom', 'Many pictures with one set of choices'],
    faq: [
      ['Does rotating lose quality?', 'The rotation itself loses nothing, because pixels are only moved. A JPG has to be saved again afterwards, which can cost a little quality.'],
      ['Why does my photo show sideways?', 'Phones record how the camera was held, and some programs ignore it. Turn it here and save the picture the right way up.'],
    ],
  },
  'crop-image': {
    title: 'Crop images online, free and private | Ream',
    description: 'Drag to choose the part of a picture to keep, then save the cropped image. Runs in your browser; nothing is uploaded.',
    intro: 'Cut a picture down to what matters. Drag a rectangle over the picture, move and resize it until it is right, and save just that part. The picture is cropped by your own browser and never uploaded.',
    points: ['Drag a rectangle over the picture', 'Move and resize it until it is right', 'The kept area has the resolution it had before'],
    faq: [
      ['Does cropping reduce the resolution?', 'No. The part you keep has the same pixels it had; nothing is scaled.'],
      ['Is the cropped-away part really gone?', 'Yes. The saved file contains only the area you kept.'],
    ],
  },
  'merge-images': {
    title: 'Merge images into one: row, column or grid | Ream',
    description: 'Join pictures into one image, side by side, stacked or in a grid, with the gap and background you choose. No upload.',
    intro: 'Combine several pictures into a single image. Place them in a row, a column or a grid, set the gap between them, choose a white or transparent background, and save the result as PNG, JPG or another format.',
    points: ['Horizontal, vertical or grid layouts', 'A gap between pictures, and a background', 'Save as PNG, JPG, WebP, GIF or BMP'],
    faq: [
      ['What if my pictures are different sizes?', 'In a row, every picture is scaled to the shortest height, and in a column to the narrowest width, so nothing is enlarged. In a grid, each picture is fitted inside equal cells.'],
      ['Can I change the order?', 'Yes. Move the pictures up or down in the list before you merge.'],
    ],
  },
  'compress-image': {
    title: 'Compress images online: JPG, PNG, WebP | Ream',
    description: 'Make photos and graphics smaller with a quality setting, and fewer colours for PNG and GIF. See the new size first.',
    intro: 'Shrink pictures to save space or load faster. Lower the quality of JPG and WebP photos, or reduce the colours of PNG and GIF graphics, and Ream shows the new size as you adjust. A picture that cannot get smaller is returned as it was.',
    points: ['A quality setting for JPG and WebP', 'Fewer colours for PNG and GIF, with or without dithering', 'Keeps the colour profile; camera data is removed unless you keep it'],
    faq: [
      ['How much smaller will it be?', 'It depends on the picture. Photographs often shrink to a fraction at 70 to 80 percent quality with little visible change, and graphics shrink most by reducing colours. The size is shown while you change the settings.'],
      ['Does it remove the camera and location data?', 'Yes, unless you choose to keep it. The colour profile is always kept so colours stay right.'],
    ],
  },
  'animated-gif': {
    title: 'Make an animated GIF from images online | Ream',
    description: 'Turn pictures into a looping animated GIF. Set the delay, size, loop and fit. Runs in your browser; nothing is uploaded.',
    intro: 'Build a GIF from a set of pictures: a slideshow, a before-and-after, a stop-motion. Put the pictures in order, choose how long each stays, whether it loops, the width, and how pictures of different shapes fit the frame.',
    points: ['Set the delay per picture, and loop forever or once', 'Contain, cover or stretch pictures to one size', 'Play forwards and back, with up to 256 colours'],
    faq: [
      ['Why is my GIF so large?', 'A GIF stores every frame in full, with at most 256 colours. Use a smaller width, fewer colours or fewer pictures. Ream accepts up to 300 pictures.'],
      ['Can I turn a video into a GIF?', 'Not at the moment. Ream builds GIFs from pictures.'],
    ],
  },
  'image-metadata': {
    title: 'Remove EXIF and location data from photos | Ream',
    description: 'See the camera, date and GPS location hidden in a photo, and remove it before you share. The picture is not touched.',
    intro: 'Photos often carry details you did not mean to share: the camera model, the time and, from phones, where the picture was taken. Ream shows what a JPG or PNG contains and removes either everything or only the location, without touching the picture itself.',
    points: ['See the camera, date and GPS data in a photo', 'Remove everything, or only the location', 'The picture is not re-encoded, so quality is unchanged'],
    faq: [
      ['Does cleaning a photo reduce its quality?', 'No. Ream removes the metadata from the file and leaves the picture data exactly as it was.'],
      ['Which files can it clean?', 'JPG and PNG files. Other formats cannot be cleaned yet.'],
    ],
  },
  'watermark-image': {
    title: 'Add a watermark to images online | Ream',
    description: 'Stamp text or your logo on photos, once or tiled, with size, opacity, angle and position. Many pictures at once.',
    intro: 'Brand or protect your pictures. Type a text or add a logo, choose where it goes, how big and how see-through it is, and tilt it if you like. Apply it to one picture or to a whole batch.',
    points: ['Text or a logo as the mark', 'A single mark, or a tile repeated across the picture', 'Size, opacity, angle and position'],
    faq: [
      ['Can a watermark be removed?', 'A visible watermark discourages copying but is not a lock. A mark in a corner can be cropped or retouched away; tiling it across the picture makes that harder.'],
      ['Can I use a logo with a transparent background?', 'Yes. Add a PNG with transparency and it is placed without a box around it.'],
    ],
  },
  'blur-image': {
    title: 'Blur or hide faces and details in photos | Ream',
    description: 'Blur, pixelate or cover faces, number plates and other details in a picture. Runs on your device; nothing is uploaded.',
    intro: 'Hide what should not be seen. Drag over a face, a number plate or a screen, and blur it, pixelate it or cover it with a solid box. You can mark several areas, and the result is saved as a new picture.',
    points: ['Blur, pixelate or a solid box', 'Several areas in one picture', 'The strength scales with the size of each area'],
    faq: [
      ['Which way hides best?', 'A solid box. Blur and pixelation can sometimes be reversed or guessed by software, while a solid box replaces the original pixels.'],
      ['Does it find faces automatically?', 'Not at the moment. You drag over the areas yourself.'],
    ],
  },
  'filters-image': {
    title: 'Photo filters and adjustments online | Ream',
    description: 'Adjust brightness, contrast, colour, warmth and sharpness, or use a ready-made look. Many pictures at once.',
    intro: 'Improve or restyle photos. Move the sliders for brightness, contrast, saturation, warmth, sepia, vignette, blur and sharpness, or start from a ready-made look such as black and white. See the result before you save, on one picture or many.',
    points: ['Eight adjustments you can combine', 'Ready-made looks as a starting point', 'The same settings applied to every picture you add'],
    faq: [
      ['Can I apply the same filter to many photos?', 'Yes. Add them all and the settings apply to every picture.'],
      ['Is the original changed?', 'No. Your file stays as it is, and the edited picture is saved as a new one.'],
    ],
  },
  meme: {
    title: 'Meme maker: add captions to any image | Ream',
    description: 'Add bold top and bottom captions to a picture and download your meme. Runs in your browser; nothing is uploaded.',
    intro: 'Make a meme from any picture. Type a top caption, a bottom caption or both; they are drawn as big letters with a black outline, sized to fit the picture. Download it in the picture\'s own format.',
    points: ['A top caption, a bottom caption, or both', 'Bold letters with a black outline, white by default', 'Choose the caption size and colour'],
    faq: [
      ['Is my picture uploaded to a meme site?', 'No. The caption is drawn by your own browser and the picture never leaves your device.'],
      ['Which pictures work?', 'JPG, PNG, WebP, GIF and BMP. A GIF or BMP is saved as a PNG, and only the first frame of a GIF is used.'],
    ],
  },
}
