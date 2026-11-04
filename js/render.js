// Turns label text into 1-bit raster lines for the print head.
// Orientation (verified from the capture): one raster line = one column of the label,
// sent left to right; the top of the text is the lowest dot number in the line.

import { LINE_BYTES } from './protocol.js';

const FONT = 'bold {size}px system-ui, -apple-system, sans-serif';
const PAD = 4; // blank columns before and after the text

export function renderText(text, area) {
  const { offset, dots } = area;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Size the font so ascenders and descenders fill the printable height.
  const font = (size) => FONT.replace('{size}', size);
  ctx.font = font(100);
  const ref = ctx.measureText('Hgjy');
  const size = Math.floor((100 * (dots - 2)) / (ref.actualBoundingBoxAscent + ref.actualBoundingBoxDescent));
  ctx.font = font(size);
  const m = ctx.measureText('Hgjy');
  const t = ctx.measureText(text);
  const textWidth = Math.ceil(t.actualBoundingBoxLeft + t.actualBoundingBoxRight);

  canvas.width = Math.max(1, textWidth) + 2 * PAD;
  canvas.height = dots;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = font(size); // resizing the canvas resets the context
  const baseline = (dots - (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)) / 2 + m.actualBoundingBoxAscent;
  ctx.fillText(text, PAD + t.actualBoundingBoxLeft, baseline);

  const px = ctx.getImageData(0, 0, canvas.width, dots).data;
  const lines = [];
  for (let x = 0; x < canvas.width; x++) {
    const line = new Uint8Array(LINE_BYTES);
    for (let y = 0; y < dots; y++) {
      if (px[(y * canvas.width + x) * 4] < 128) {
        const bit = offset + y;
        line[bit >> 3] |= 0x80 >> (bit & 7);
      }
    }
    lines.push(line);
  }
  return lines;
}

// Draw raster lines back into a canvas, so the preview shows exactly what gets sent.
export function drawPreview(canvas, lines, area) {
  const { offset, dots } = area;
  canvas.width = lines.length;
  canvas.height = dots;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(lines.length, dots);
  lines.forEach((line, x) => {
    for (let y = 0; y < dots; y++) {
      const bit = offset + y;
      const on = line[bit >> 3] & (0x80 >> (bit & 7));
      const i = (y * lines.length + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = on ? 0 : 255;
      img.data[i + 3] = 255;
    }
  });
  ctx.putImageData(img, 0, 0);
}
