// Label designer: lays out text, a graphic and a border on a canvas that is exactly
// as tall as the printable area (one canvas pixel = one printer dot, 180 dpi).
// The canvas is then turned into raster lines by render.js.

import { capacity, encodeQr } from './qr.js';
import { PRINTER_GAP_DOTS } from './protocol.js';

export const DPI = 180;
export const mmToDots = (mm) => Math.round((mm / 25.4) * DPI);
export const dotsToMm = (dots) => (dots * 25.4) / DPI;
export const PX_PER_PT = DPI / 72; // font sizes in the UI are in points

// Fonts marked `web` come from Google Fonts (linked in index.html) and must be loaded before drawing.
export const FONTS = {
  sans: { name: 'Sans', css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  condensed: { name: 'Condensed', css: '"Roboto Condensed", "Arial Narrow", sans-serif', web: true },
  rounded: { name: 'Rounded', css: 'Nunito, system-ui, sans-serif', web: true },
  serif: { name: 'Serif', css: 'Georgia, "Noto Serif", "Times New Roman", serif' },
  mono: { name: 'Monospace', css: '"Roboto Mono", Menlo, Consolas, monospace', web: true },
  hand: { name: 'Handwritten', css: 'Caveat, cursive', web: true },
};

export function fontString(d, px) {
  const f = FONTS[d.font] ?? FONTS.sans;
  return `${d.italic ? 'italic ' : ''}${d.bold ? 'bold ' : ''}${Math.max(1, Math.round(px))}px ${f.css}`;
}

// Resolves once the design's font can be drawn on a canvas.
export function loadFont(d) {
  if (!FONTS[d.font]?.web || !document.fonts) return Promise.resolve();
  return document.fonts.load(fontString(d, 40), 'Ag').catch(() => {});
}

export const BORDERS = {
  none: { name: 'None' },
  thin: { name: 'Thin', width: 2 },
  thick: { name: 'Thick', width: 4 },
  rounded: { name: 'Rounded', width: 2, radius: 10 },
  pill: { name: 'Pill', width: 2, pill: true },
  double: { name: 'Double', width: 2, double: true },
  dashed: { name: 'Dashed', width: 2, dash: [6, 4] },
  bars: { name: 'Bars', width: 2, bars: true }, // a line above and below, open at the ends
};
const BORDER_INSET = 2; // keep lines off the very edge of the printable area

// Built-in graphics: SVG path data, 24 units tall unless h says otherwise; w = width (default 24).
export const ICONS = {
  hv: { name: 'High voltage', w: 18, path: 'M11.5.5.5 14H8L5.5 23.5l12-14H10z' },
  warning: { name: 'Warning', path: 'M12 1 23.5 21.5H.5zM12 4.5 3.4 19.8h17.2zM10.8 8.6h2.4v6.4h-2.4zM10.8 16.2h2.4v2.4h-2.4z', evenodd: true },
  dcpos: { name: 'DC jack: center positive', w: 48, h: 16, path: 'M30.63 11.5A7.5 7.5 0 1 1 30.63 4.5H28.24A5.5 5.5 0 1 0 28.24 11.5zM21.5 8A2.5 2.5 0 1 1 26.5 8A2.5 2.5 0 1 1 21.5 8zM24 7H35.5V9H24zM12.5 7H17V9H12.5zM1 8A6 6 0 1 1 13 8A6 6 0 1 1 1 8zM2.5 8A4.5 4.5 0 1 0 11.5 8A4.5 4.5 0 1 0 2.5 8zM35 8A6 6 0 1 1 47 8A6 6 0 1 1 35 8zM36.5 8A4.5 4.5 0 1 0 45.5 8A4.5 4.5 0 1 0 36.5 8zM4.4 7.2H9.6V8.8H4.4zM38.4 7.2H43.6V8.8H38.4zM40.2 5.4H41.8V10.6H40.2z' },
  dcneg: { name: 'DC jack: center negative', w: 48, h: 16, path: 'M30.63 11.5A7.5 7.5 0 1 1 30.63 4.5H28.24A5.5 5.5 0 1 0 28.24 11.5zM21.5 8A2.5 2.5 0 1 1 26.5 8A2.5 2.5 0 1 1 21.5 8zM24 7H35.5V9H24zM12.5 7H17V9H12.5zM1 8A6 6 0 1 1 13 8A6 6 0 1 1 1 8zM2.5 8A4.5 4.5 0 1 0 11.5 8A4.5 4.5 0 1 0 2.5 8zM35 8A6 6 0 1 1 47 8A6 6 0 1 1 35 8zM36.5 8A4.5 4.5 0 1 0 45.5 8A4.5 4.5 0 1 0 36.5 8zM4.4 7.2H9.6V8.8H4.4zM6.2 5.4H7.8V10.6H6.2zM38.4 7.2H43.6V8.8H38.4z' },
  wifi: { name: 'WiFi', path: 'M9.8 20.5A2.2 2.2 0 1 1 14.2 20.5A2.2 2.2 0 1 1 9.8 20.5zM6.7 15.2A7.5 7.5 0 0 1 17.3 15.2L15.54 16.96A5 5 0 0 0 8.46 16.96zM3.51 12.01A12 12 0 0 1 20.49 12.01L18.72 13.78A9.5 9.5 0 0 0 5.28 13.78zM0.33 8.83A16.5 16.5 0 0 1 23.67 8.83L21.9 10.6A14 14 0 0 0 2.1 10.6z' },
  ground: { name: 'Ground', path: 'M11 2H13V11H11zM2.5 11H21.5V13.2H2.5zM6.5 15.4H17.5V17.6H6.5zM10 19.8H14V22H10z' },
};

const monthYear = () => new Date().toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

export const DEFAULT_DESIGN = {
  template: 'generic',
  text: 'Hello',
  font: 'sans',
  bold: true,
  italic: false,
  sizeMode: 'auto', // 'auto' = as large as fits, 'fixed' = sizePt
  sizePt: 20,
  align: 'center',
  emphasizeFirst: false, // first line 1.5x larger than the others
  lengthMode: 'auto', // 'auto' = grow to fit, 'fixed' = lengthMm
  lengthMm: 40,
  border: 'none',
  icon: null, // key of ICONS, 'upload', or null
  iconPos: 'left',
  cableMm: 6, // cable flag: cable diameter
  cutMarks: true, // dotted lines at both ends to cut along
  cutGapMm: 1.5, // blank tape between each cut mark and the label
  centerMarks: true, // cable flag: ticks at the middle, where the cable goes
  qrText: '', // content of the QR code when icon === 'qr'
};

// Templates set a starting layout. Text is only replaced if it's still a sample.
export const TEMPLATES = {
  generic: {
    name: 'Generic',
    sample: () => 'Hello',
    settings: { lengthMode: 'auto', border: 'none', icon: null, font: 'sans', bold: true, italic: false, emphasizeFirst: false, align: 'center', sizeMode: 'auto' },
  },
  cable: {
    name: 'Cable flag',
    hint: 'Wraps around the cable; the two halves stick together back to back and read the same from both sides.',
    sample: () => 'ROUTER',
    settings: { lengthMode: 'auto', border: 'thin', icon: null, font: 'condensed', bold: true, italic: false, emphasizeFirst: false, align: 'center', sizeMode: 'auto' },
  },
  spice: {
    name: 'Spice jar',
    sample: () => `Cinnamon\n${monthYear()}`,
    settings: { lengthMode: 'fixed', lengthMm: 40, border: 'rounded', icon: null, font: 'serif', bold: true, italic: false, emphasizeFirst: true, align: 'center', sizeMode: 'auto' },
  },
};

export function isSampleText(text) {
  const t = text.trim();
  return !t || Object.values(TEMPLATES).some((tpl) => tpl.sample().split('\n')[0] === t.split('\n')[0]);
}

const textLines = (d) => d.text.split('\n').map((s) => s.trim()).filter(Boolean);

export function hasContent(d, image) {
  return textLines(d).length > 0 || !!graphicFor(d, image);
}

function graphicFor(d, image) {
  if (d.icon === 'qr') {
    const text = (d.qrText ?? '').trim();
    return text ? { aspect: 1, qrText: text } : null;
  }
  if (d.icon === 'upload') {
    return image?.naturalWidth ? { aspect: image.naturalWidth / image.naturalHeight, image } : null;
  }
  const icon = ICONS[d.icon];
  return icon ? { aspect: (icon.w ?? 24) / (icon.h ?? 24), icon } : null;
}

function drawGraphic(ctx, g, x, y, w, h) {
  ctx.save();
  if (g.qr) {
    // Whole dots only, so every module prints the same size.
    const s = g.qr.scale;
    ctx.fillStyle = '#000';
    g.qr.modules.forEach((row, my) => row.forEach((dark, mx) => {
      if (dark) ctx.fillRect(Math.round(x) + mx * s, Math.round(y) + my * s, s, s);
    }));
  } else if (g.image) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(g.image, x, y, w, h);
  } else {
    ctx.translate(x, y);
    ctx.scale(w / (g.icon.w ?? 24), h / (g.icon.h ?? 24));
    ctx.fillStyle = '#000';
    ctx.fill(new Path2D(g.icon.path), g.icon.evenodd ? 'evenodd' : 'nonzero');
  }
  ctx.restore();
}

function borderSpace(b) {
  if (!b.width) return 0;
  return BORDER_INSET + (b.double ? b.width * 2 + 2 : b.width);
}

function drawBorder(ctx, b, w, h) {
  if (!b.width) return;
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = b.width;
  if (b.bars) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, BORDER_INSET, w, b.width);
    ctx.fillRect(0, h - BORDER_INSET - b.width, w, b.width);
    ctx.restore();
    return;
  }
  if (b.dash) ctx.setLineDash(b.dash);
  const rect = (inset, radius) => {
    const i = inset + b.width / 2;
    const rw = w - 2 * i;
    const rh = h - 2 * i;
    const r = b.pill ? rh / 2 : Math.max(0, radius);
    ctx.beginPath();
    ctx.roundRect(i, i, rw, rh, Math.min(r, rh / 2, rw / 2));
    ctx.stroke();
  };
  rect(BORDER_INSET, b.radius ?? 0);
  if (b.double) rect(BORDER_INSET + b.width + 2, (b.radius ?? 0) - b.width - 2);
  ctx.restore();
}

// Biggest QR code for `text` that fits in `h` dots. Prefers bigger modules (easier to scan)
// over more error correction. Modules under 2 dots (0.28 mm) are a last resort.
function fitQr(text, h) {
  for (let scale = 4; scale >= 1; scale--) {
    const maxVersion = Math.floor((Math.floor(h / scale) - 17) / 4);
    if (maxVersion < 1) continue;
    const qr = encodeQr(text, { minEcc: 'M', maxVersion }) ?? encodeQr(text, { minEcc: 'L', maxVersion });
    if (qr) return { ...qr, scale, dots: qr.modules.length * scale };
  }
  return null;
}

// Most bytes a QR code with modules of at least 2 dots can hold in `h` dots.
function qrLimit(h) {
  const v = Math.min(10, Math.floor((Math.floor(h / 2) - 17) / 4));
  return v >= 1 ? capacity(v, 'L') : 0;
}

const measureCtx = document.createElement('canvas').getContext('2d');

// Measure the text block at a base font size (px). Each line's height is its ink height,
// but never less than a capital letter, so lines without descenders stay consistent.
function measureBlock(d, lines, basePx) {
  const ctx = measureCtx;
  const gap = Math.round(basePx * 0.12);
  let width = 0;
  let height = 0;
  const rows = lines.map((text, i) => {
    const px = d.emphasizeFirst && i === 0 && lines.length > 1 ? basePx * 1.5 : basePx;
    ctx.font = fontString(d, px);
    const m = ctx.measureText(text);
    const cap = ctx.measureText('H').actualBoundingBoxAscent;
    const row = {
      text,
      px,
      ascent: Math.max(cap, m.actualBoundingBoxAscent),
      descent: Math.max(0, m.actualBoundingBoxDescent),
      left: m.actualBoundingBoxLeft,
      width: Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight),
    };
    width = Math.max(width, row.width);
    height += row.ascent + row.descent;
    return row;
  });
  height += gap * (lines.length - 1);
  return { rows, gap, width, height: Math.ceil(height), basePx };
}

// Largest base size whose block fits in maxW x maxH.
function fitBlock(d, lines, maxW, maxH) {
  const ref = measureBlock(d, lines, 100);
  let px = Math.floor(100 * Math.min(maxH / ref.height, maxW / Math.max(1, ref.width)));
  px = Math.max(4, Math.min(px, 400));
  let block = measureBlock(d, lines, px);
  while (px > 4 && (block.height > maxH || block.width > maxW)) block = measureBlock(d, lines, --px);
  return block;
}

// Render one panel (the whole label, or one half of a cable flag).
// fixedW: width in dots, or null to grow to fit.
function renderPanel(d, H, fixedW, image, warnings) {
  const b = BORDERS[d.border] ?? BORDERS.none;
  const space = borderSpace(b);
  const padY = space ? space + 3 : 1;
  // Bars have no sides, so the ends need no more room than a label without a border.
  const sideSpace = b.bars ? 0 : space;
  let padX = sideSpace ? sideSpace + 4 + (b.pill ? Math.round(H * 0.22) : b.radius ? 3 : 0) : 4;
  const innerH = H - 2 * padY;

  const lines = textLines(d);
  let g = graphicFor(d, image);
  let gH = innerH;
  let gap = g && lines.length ? Math.round(H * 0.08) : 0;
  if (g?.qrText) {
    // Without a border the code can use the full height; the tape beyond the print area
    // is its quiet zone. Along the tape, keep a few modules clear of text and border.
    const qrH = space ? innerH : H;
    const qr = fitQr(g.qrText, qrH);
    if (!qr) {
      const n = qrLimit(qrH);
      warnings.push(n
        ? `QR text is too long for this tape: ${n} characters at most${space ? ' (more without a border)' : ''}.`
        : 'This tape is too narrow for a QR code.');
      g = null;
      gap = 0;
    } else {
      if (qr.scale < 2) warnings.push('The QR code\'s dots are very small and may not scan; use shorter text.');
      g.qr = qr;
      gH = qr.dots;
      gap = lines.length ? Math.max(gap, 4 * qr.scale) : 0;
      padX = Math.max(padX, sideSpace + 3 * qr.scale);
    }
  }
  const gW = g ? Math.max(1, Math.round(gH * g.aspect)) : 0;

  let block = null;
  if (lines.length) {
    const availW = fixedW ? fixedW - 2 * padX - gW - gap : Infinity;
    if (d.sizeMode === 'fixed') {
      block = measureBlock(d, lines, d.sizePt * PX_PER_PT);
      if (block.height > innerH) warnings.push('Text is taller than the tape; the top and bottom get cut off.');
      if (block.width > availW) warnings.push('Text is longer than the fixed length; it gets cut off.');
    } else {
      block = fitBlock(d, lines, availW > 0 ? availW : 1, innerH);
      if (availW <= 0 || block.basePx < 8 * PX_PER_PT) {
        warnings.push('Text had to shrink below 8 pt to fit; try a longer fixed length or fewer words per line.');
      }
    }
  }

  const contentW = gW + gap + (block?.width ?? 0);
  const W = fixedW ?? Math.max(contentW + 2 * padX, mmToDots(5));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  drawBorder(ctx, b, W, H);

  // Area left for the text once the graphic sits at its edge.
  let tx0 = padX;
  let tx1 = W - padX;
  if (g) {
    const gy = g.qr ? Math.floor((H - gH) / 2) : padY + (innerH - gH) / 2;
    let gx;
    if (!block) gx = Math.floor((W - gW) / 2);
    else if (d.iconPos === 'right') gx = fixedW ? tx1 - gW : padX + block.width + gap;
    else gx = padX;
    drawGraphic(ctx, g, gx, gy, gW, gH);
    if (d.iconPos === 'right') tx1 = gx - gap;
    else tx0 = gx + gW + gap;
  }

  if (block) {
    ctx.fillStyle = '#000';
    let y = padY + (innerH - block.height) / 2;
    for (const row of block.rows) {
      ctx.font = fontString(d, row.px);
      let x;
      if (d.align === 'left') x = tx0;
      else if (d.align === 'right') x = tx1 - row.width;
      else x = tx0 + (tx1 - tx0 - row.width) / 2;
      ctx.fillText(row.text, x + row.left, y + row.ascent);
      y += row.ascent + row.descent + block.gap;
    }
  }
  return { canvas, basePx: block?.basePx ?? null };
}

// Render the whole label. Returns { canvas, warnings, basePx, labelDots }: canvas is
// `area.dots` tall and one pixel per raster line wide; labelDots is the finished label's
// length on tape (between the cut marks, if any).
// chained: the label is printed with chain printing on, so the next label follows right behind it.
//   It gets only a leading cut mark; the printer's PRINTER_GAP_DOTS of blank tape plus the next
//   label's leading mark close it off, and a fixed length counts that gap.
// forceMarks: draw cut marks even if the design has them off (a run of labels needs them).
export function renderLabel(d, area, image = null, { chained = false, forceMarks = false } = {}) {
  const warnings = [];
  const marks = d.cutMarks || forceMarks || chained;
  // Blank tape between each cut mark and the label. A fixed length includes it.
  const lead = marks ? mmToDots(Math.max(0, d.cutGapMm ?? 1.5)) : 0;
  // After a chained label the printer adds its gap on its own, so draw only what's missing.
  const tail = chained ? Math.max(lead, PRINTER_GAP_DOTS) : lead;
  const drawnTail = chained ? tail - PRINTER_GAP_DOTS : tail;
  let fixedW = null;
  if (d.lengthMode === 'fixed') {
    fixedW = mmToDots(d.lengthMm) - lead - tail;
    if (fixedW < mmToDots(5)) {
      warnings.push('The cut mark gap leaves too little room in this length.');
      fixedW = mmToDots(5);
    }
  }
  const { canvas, basePx } = renderBody(d, area.dots, fixedW, image, warnings);
  if (!marks) return { canvas, warnings, basePx, labelDots: canvas.width };
  const out = withCutMarks(canvas, lead, drawnTail, !chained);
  return { canvas: out, warnings, basePx, labelDots: lead + canvas.width + tail };
}

export const CUT_MARK_DOTS = 2;

function drawCutMark(ctx, x, H) {
  ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 7) ctx.fillRect(x, y, CUT_MARK_DOTS, 4);
}

// [mark][lead][label][tail][mark]; a chained label leaves out the trailing mark.
// Cut through the marks; the length between the marks' inner edges is the label length.
function withCutMarks(label, lead, tail, trailingMark) {
  const H = label.height;
  const canvas = document.createElement('canvas');
  canvas.width = CUT_MARK_DOTS + lead + label.width + tail + (trailingMark ? CUT_MARK_DOTS : 0);
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, H);
  ctx.drawImage(label, CUT_MARK_DOTS + lead, 0);
  drawCutMark(ctx, 0, H);
  if (trailingMark) drawCutMark(ctx, canvas.width - CUT_MARK_DOTS, H);
  return canvas;
}

// Just a cut mark: printed by "Feed out" to close off a chained label.
export function renderCutMark(area) {
  const canvas = document.createElement('canvas');
  canvas.width = CUT_MARK_DOTS;
  canvas.height = area.dots;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawCutMark(ctx, 0, canvas.height);
  return canvas;
}

// fixedW: body width in dots, or null to grow to fit.
function renderBody(d, H, fixedW, image, warnings) {

  if (d.template !== 'cable') {
    const panel = renderPanel(d, H, fixedW, image, warnings);
    return { canvas: panel.canvas, basePx: panel.basePx };
  }

  // Cable flag: [panel][wrap gap][panel rotated 180°]. The gap goes around the cable.
  const gapW = mmToDots(Math.PI * d.cableMm + 1);
  let halfW = null;
  if (fixedW) {
    halfW = Math.floor((fixedW - gapW) / 2);
    if (halfW < mmToDots(5)) {
      warnings.push('Fixed length is too short for this cable.');
      halfW = mmToDots(5);
    }
  }
  const panel = renderPanel(d, H, halfW, image, warnings);
  const pw = panel.canvas.width;
  const canvas = document.createElement('canvas');
  canvas.width = fixedW && fixedW > 2 * pw + gapW ? fixedW : 2 * pw + gapW;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, H);
  ctx.drawImage(panel.canvas, 0, 0);
  ctx.save();
  ctx.translate(canvas.width, H);
  ctx.rotate(Math.PI);
  ctx.drawImage(panel.canvas, 0, 0);
  ctx.restore();
  if (d.centerMarks) {
    // Short ticks at both edges, in the middle of the wrap: line the cable up with them.
    const len = Math.round(H * 0.18);
    const x = Math.round(canvas.width / 2) - 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(x, 0, 2, len);
    ctx.fillRect(x, H - len, 2, len);
  }
  return { canvas, basePx: panel.basePx };
}
