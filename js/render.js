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
// Extra tape around the image, in dots: `before`/`after` is blank tape the printer feeds on its own
// (part of the label), `waste` is dimmed tape beyond that (cut off), and `ghostMark` draws a faint
// cut mark at the end of `after` (the next label's leading mark, for a chained label).
export function drawPreview(canvas, lines, area, tapeMm, { tape = '#ffffff', ink = '#000000' } = {},
  { before = 0, after = 0, waste = 0, ghostMark = false } = {}) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  const tapeC = rgb(tape);
  const inkC = rgb(ink);
  const wasteC = mix(tapeC, [128, 128, 128], 0.35);
  const ghostC = mix(tapeC, inkC, 0.4);
  const { offset, dots } = area;
  const tapeDots = Math.max(dots, mmToDots(tapeMm === 4 ? 3.5 : tapeMm));
  const top = Math.floor((tapeDots - dots) / 2);
  if (!lines.length) before = after = waste = 0;
  const x0 = waste + before;
  const w = Math.max(1, x0 + lines.length + after + waste);
  canvas.width = w;
  canvas.height = tapeDots;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, tapeDots);
  const px = (x, y, c) => img.data.set([...c, 255], (y * w + x) * 4);
  for (let y = 0; y < tapeDots; y++) {
    for (let x = 0; x < w; x++) px(x, y, x < waste || x >= w - waste ? wasteC : tapeC);
  }
  lines.forEach((line, x) => {
    for (let y = 0; y < dots; y++) {
      const bit = offset + y;
      if (line[bit >> 3] & (0x80 >> (bit & 7))) px(x0 + x, top + y, inkC);
    }
  });
  if (ghostMark && lines.length) {
    // Same pattern as the drawn cut mark: 2 dots wide, 4 on / 3 off.
    for (let x = w - waste - 2; x < w - waste; x++) {
      for (let y = 0; y < dots; y++) if (y % 7 < 4) px(x, top + y, ghostC);
    }
  }
  ctx.putImageData(img, 0, 0);
}
