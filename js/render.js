// Turns a label canvas into 1-bit raster lines for the print head, and draws them back for the preview.
// Orientation (verified from the capture): one raster line = one column of the label,
// sent left to right; the top of the label is the lowest dot number in the line.

import { LINE_BYTES } from './protocol.js';
import { mmToDots } from './design.js';

// `canvas` must be exactly `area.dots` tall.
export function canvasToLines(canvas, area) {
  const { offset, dots } = area;
  const w = canvas.width;
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, dots).data;
  const lines = [];
  for (let x = 0; x < w; x++) {
    const line = new Uint8Array(LINE_BYTES);
    for (let y = 0; y < dots; y++) {
      const i = (y * w + x) * 4;
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (px[i + 3] >= 128 && lum < 128) {
        const bit = offset + y;
        line[bit >> 3] |= 0x80 >> (bit & 7);
      }
    }
    lines.push(line);
  }
  return lines;
}

// Draw raster lines back into a canvas, so the preview shows exactly what gets sent.
// The full tape width is shown; the unprintable strips at the edges stay blank.
export function drawPreview(canvas, lines, area, tapeMm, { tape = '#ffffff', ink = '#000000' } = {}) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [tr, tg, tb] = rgb(tape);
  const [ir, ig, ib] = rgb(ink);
  const { offset, dots } = area;
  const tapeDots = Math.max(dots, mmToDots(tapeMm === 4 ? 3.5 : tapeMm));
  const top = Math.floor((tapeDots - dots) / 2);
  const w = Math.max(1, lines.length);
  canvas.width = w;
  canvas.height = tapeDots;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, tapeDots);
  for (let i = 0; i < img.data.length; i += 4) img.data.set([tr, tg, tb, 255], i);
  lines.forEach((line, x) => {
    for (let y = 0; y < dots; y++) {
      const bit = offset + y;
      if (line[bit >> 3] & (0x80 >> (bit & 7))) img.data.set([ir, ig, ib, 255], ((top + y) * w + x) * 4);
    }
  });
  ctx.putImageData(img, 0, 0);
}
