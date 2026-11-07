import { Printer } from './printer.js';
import { MARGIN_DOTS, PRINTER_GAP_DOTS, PRINT_AREA, buildJob } from './protocol.js';
import { canvasToLines, drawPreview } from './render.js';
import {
  BORDERS, DEFAULT_DESIGN, FONTS, ICONS, PX_PER_PT, TEMPLATES,
  CUT_MARK_DOTS, dotsToMm, hasContent, mmToDots, isSampleText, loadFont, renderCutMark, renderLabel,
} from './design.js';

const $ = (id) => document.getElementById(id);
const logEl = $('log');

function log(msg, cls = '') {
  const t = new Date().toISOString().slice(11, 23);
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = `${t}  ${msg}`;
  logEl.append(line);
  logEl.scrollTop = logEl.scrollHeight;
}

let connected = false;
let printing = false;
let stopRequested = false;
let tapeMm = 12; // assumed until the printer reports its tape
let printerColors = {}; // preview colors as reported by the printer
let lastBasePx = null; // font size the last render picked, to prefill "custom size"
let lastLabelDots = 0; // label length in the last render, to prefill "fixed length"

// Chain printing: labels stay inside the printer so the next one prints right behind it.
// `parked` = the last label printed was chained, so it still needs a label after it or "Feed out".
const readFlag = (key) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const writeFlag = (key, on) => { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* ignore */ } };
let chainOn = readFlag('chain');
let parked = readFlag('parked');

const copiesWanted = () => Math.max(1, Math.min(50, parseInt($('copies').value, 10) || 1));

// A run of labels (chained, several copies, or following a parked label) needs cut marks to cut it apart.
const marksForced = () => chainOn || parked || copiesWanted() > 1;
const marksOn = () => design.cutMarks || marksForced();

// The label design, saved between visits. An uploaded graphic is kept as a data URL.
let design = { ...DEFAULT_DESIGN };
try {
  design = { ...design, ...JSON.parse(localStorage.getItem('design') || '{}') };
} catch { /* ignore a corrupt save */ }
let uploadedImage = null;

function saveDesign() {
  try {
    localStorage.setItem('design', JSON.stringify(design));
  } catch {
    // Probably a large uploaded image; keep everything else.
    localStorage.setItem('design', JSON.stringify({ ...design, imageData: undefined }));
  }
}

function loadImage(dataUrl) {
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    uploadedImage = img;
    buildIconPicker();
    updatePreview();
  };
  img.src = dataUrl;
}

// Manual choices, for cartridges (often knockoffs) that report the wrong color.
const COLOR_PRESETS = {
  'black-white': ['Black on white', '#111111', '#ffffff'],
  'black-yellow': ['Black on yellow', '#111111', '#f7d23e'],
  'white-black': ['White on black', '#ffffff', '#111111'],
  'black-clear': ['Black on clear', '#111111', '#eef2f3'],
  'red-white': ['Red on white', '#d62828', '#ffffff'],
  'blue-white': ['Blue on white', '#1e5bb8', '#ffffff'],
  'black-red': ['Black on red', '#111111', '#d62828'],
  'black-blue': ['Black on blue', '#111111', '#4a90e2'],
  'black-green': ['Black on green', '#111111', '#2e9e4f'],
  'white-blue': ['White on blue', '#ffffff', '#1e5bb8'],
  'white-red': ['White on red', '#ffffff', '#d62828'],
  'gold-black': ['Gold on black', '#c9a94a', '#111111'],
  'white-clear': ['White on clear', '#ffffff', '#9ca3af'],
};

function previewColors() {
  const preset = COLOR_PRESETS[$('tape-colors').value];
  return preset ? { ink: preset[1], tape: preset[2] } : printerColors;
}

function updateButtons() {
  $('conn-state').textContent = connected ? 'Connected' : 'Disconnected';
  $('conn-state').className = `pill ${connected ? 'on' : 'off'}`;
  $('btn-connect').hidden = connected;
  $('btn-disconnect').disabled = !connected || printing;
  $('btn-status').disabled = !connected || printing;
  $('btn-print').disabled = !connected || printing || !hasContent(design, uploadedImage);
  $('btn-feed').disabled = !connected || printing;
  $('btn-stop').hidden = !printing || stopRequested;
}

function showStatus(s) {
  const rows = {
    'Status': s.statusType,
    'Battery': s.battery,
    'Tape width': `${s.mediaWidthMm} mm`,
    'Tape': `${s.tapeColor.name} tape, ${s.textColor.name.toLowerCase()} text (${s.mediaTypeName})`,
    'Errors': s.errors.length ? s.errors.join(', ') : 'None',
    'Phase': s.phaseType,
  };
  $('status').innerHTML = '';
  for (const [k, v] of Object.entries(rows)) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    $('status').append(dt, dd);
  }
}

const printer = new Printer({
  log,
  onStatus: (s) => {
    showStatus(s);
    $('tape-colors').options[0].text = `Auto (printer says ${s.textColor.name.toLowerCase()} on ${s.tapeColor.name.toLowerCase()})`;
    const colors = { tape: s.tapeColor.css, ink: s.textColor.css };
    if (colors.tape && colors.ink && (colors.tape !== printerColors.tape || colors.ink !== printerColors.ink)) {
      printerColors = colors;
      updatePreview();
    }
    if (PRINT_AREA[s.mediaWidthMm] && s.mediaWidthMm !== tapeMm) {
      tapeMm = s.mediaWidthMm;
      updatePreview();
    }
  },
  onConnectionChange: (on) => {
    connected = on;
    updateButtons();
  },
});

// Build the raster lines for the current design. Fonts must be loaded first (see loadFont).
// chained: print this label with chain printing on (see renderLabel).
function renderDesign(area, chained = chainOn) {
  const opts = { chained, forceMarks: marksForced() };
  const { canvas, warnings, basePx, labelDots } = renderLabel(design, area, uploadedImage, opts);
  return { lines: canvasToLines(canvas, area), warnings, basePx, labelDots };
}

function updatePreview() {
  const area = PRINT_AREA[tapeMm];
  const empty = !hasContent(design, uploadedImage);
  const { lines, warnings, basePx, labelDots } = empty ? { lines: [], warnings: [] } : renderDesign(area);
  lastBasePx = basePx;
  lastLabelDots = labelDots;
  // Show the tape around the label too, so the cut marks don't sit on the preview's edge.
  // With marks, the cuts land on them (margin 0); a chained label is followed by the printer's
  // gap and the next label's mark. Without marks, the printer adds its margin at both ends.
  const ends = !marksOn()
    ? { before: MARGIN_DOTS, after: MARGIN_DOTS }
    : chainOn ? { after: PRINTER_GAP_DOTS + CUT_MARK_DOTS, ghostMark: true } : {};
  drawPreview($('preview'), lines, area, tapeMm, previewColors(), { waste: mmToDots(4), ...ends });
  const mm = dotsToMm(labelDots ?? 0).toFixed(1);
  const size = basePx ? ` · text ${Math.round(basePx / PX_PER_PT)} pt` : '';
  $('preview-info').textContent = empty
    ? 'Add some text or a graphic.'
    : `${tapeMm} mm tape${area.verified ? '' : ' (print area not yet verified)'} · ${mm} mm long${marksOn() ? ' between the cut marks' : ' (plus a blank margin the printer adds at each end)'}${size}`;
  $('preview-warn').hidden = !warnings.length;
  $('preview-warn').textContent = [...new Set(warnings)].join(' ');
  updateButtons();
  // A web font that isn't loaded yet draws as a fallback; redraw once it arrives.
  if (FONTS[design.font]?.web && !document.fonts.check(`20px ${FONTS[design.font].css}`)) {
    loadFont(design).then(() => document.fonts.check(`20px ${FONTS[design.font].css}`) && updatePreview());
  }
}

// Copy the design into the form controls.
function syncForm() {
  $('label-text').value = design.text;
  $('cable-mm').value = design.cableMm;
  $('length-mode').value = design.lengthMode;
  $('length-mm').value = design.lengthMm;
  $('font').value = design.font;
  $('bold').checked = design.bold;
  $('italic').checked = design.italic;
  $('size-mode').value = design.sizeMode;
  $('size-pt').value = design.sizePt;
  $('align').value = design.align;
  $('emphasize').checked = design.emphasizeFirst;
  $('icon-pos').value = design.iconPos;
  $('cut-marks').checked = marksOn();
  $('cut-marks').disabled = marksForced();
  $('cut-marks').parentElement.title = marksForced()
    ? 'Always on when printing a run of labels: cut the strip apart at the marks.'
    : 'Dotted lines at both ends of each label. Cut through them for an exact length.';
  $('cut-gap').value = design.cutGapMm;
  $('cut-gap-wrap').hidden = !marksOn();
  $('chain').checked = chainOn;
  $('chain-hint').textContent = parked
    ? 'The last label is still inside the printer. Print the next one, or press Feed out to finish the strip.'
    : chainOn
      ? 'Each label stays inside so the next one prints right behind it. Turn this off for the last label, or press Feed out after it.'
      : '';
  $('chain-hint').hidden = !parked && !chainOn;
  $('center-marks').checked = design.centerMarks;
  $('qr-text').value = design.qrText;
  $('qr-opts').hidden = design.icon !== 'qr';
  $('cable-opts').hidden = design.template !== 'cable';
  $('length-wrap').hidden = design.lengthMode !== 'fixed';
  $('size-wrap').hidden = design.sizeMode !== 'fixed';
  $('template-hint').textContent = TEMPLATES[design.template]?.hint ?? '';
  $('template-hint').hidden = !TEMPLATES[design.template]?.hint;
  for (const b of $('templates').children) b.classList.toggle('on', b.dataset.value === design.template);
  for (const b of $('borders').children) b.classList.toggle('on', b.dataset.value === design.border);
  for (const b of $('icons').children) b.classList.toggle('on', b.dataset.value === String(design.icon));
}

function setDesign(changes) {
  Object.assign(design, changes);
  saveDesign();
  syncForm();
  updatePreview();
}

function segButton(container, value, content, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.value = value;
  if (typeof content === 'string') b.textContent = content;
  else b.append(content);
  b.onclick = onClick;
  container.append(b);
  return b;
}

function iconSvg(icon) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', icon.path);
  if (icon.evenodd) path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return svg;
}

function buildIconPicker() {
  const box = $('icons');
  box.innerHTML = '';
  segButton(box, 'null', 'None', () => setDesign({ icon: null }));
  for (const [key, icon] of Object.entries(ICONS)) {
    segButton(box, key, iconSvg(icon), () => setDesign({ icon: key })).title = icon.name;
  }
  segButton(box, 'qr', 'QR', () => {
    setDesign({ icon: 'qr' });
    if (!design.qrText) $('qr-text').focus();
  }).title = 'QR code: a link or text your phone camera can read';
  if (uploadedImage) {
    const img = document.createElement('img');
    img.src = uploadedImage.src;
    segButton(box, 'upload', img, () => setDesign({ icon: 'upload' })).title = 'Your image';
  }
  segButton(box, 'pick', 'Upload…', () => $('upload').click()).title = 'Use your own image (PNG, JPG, SVG). Dark parts print.';
  syncForm();
}

function buildDesigner() {
  for (const [key, tpl] of Object.entries(TEMPLATES)) {
    segButton($('templates'), key, tpl.name, () => {
      const changes = { template: key, ...tpl.settings };
      if (isSampleText(design.text)) changes.text = tpl.sample();
      setDesign(changes);
    });
  }
  for (const [key, b] of Object.entries(BORDERS)) {
    segButton($('borders'), key, b.name, () => setDesign({ border: key }));
  }
  for (const [key, f] of Object.entries(FONTS)) $('font').append(new Option(f.name, key));
  buildIconPicker();

  const num = (id, min, max, fallback) => {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  };
  // Text and number fields update the preview while typing, without rewriting the field.
  const live = (id, fn) => {
    $(id).oninput = () => {
      Object.assign(design, fn());
      saveDesign();
      updatePreview();
    };
  };
  live('label-text', () => ({ text: $('label-text').value }));
  live('cable-mm', () => ({ cableMm: num('cable-mm', 1, 40, design.cableMm) }));
  live('length-mm', () => ({ lengthMm: num('length-mm', 5, 500, design.lengthMm) }));
  live('cut-gap', () => ({ cutGapMm: num('cut-gap', 0, 10, design.cutGapMm) }));
  live('qr-text', () => ({ qrText: $('qr-text').value }));
  live('size-pt', () => ({ sizePt: num('size-pt', 4, 60, design.sizePt) }));

  $('length-mode').onchange = () => {
    const mode = $('length-mode').value;
    // Start a fixed length from the current length, so the label doesn't jump.
    const lengthMm = mode === 'fixed' && lastLabelDots ? Math.round(dotsToMm(lastLabelDots)) : design.lengthMm;
    setDesign({ lengthMode: mode, lengthMm });
  };
  $('size-mode').onchange = () => {
    const mode = $('size-mode').value;
    const sizePt = mode === 'fixed' && lastBasePx ? Math.round(lastBasePx / PX_PER_PT) : design.sizePt;
    setDesign({ sizeMode: mode, sizePt });
  };
  $('font').onchange = () => setDesign({ font: $('font').value });
  $('bold').onchange = () => setDesign({ bold: $('bold').checked });
  $('italic').onchange = () => setDesign({ italic: $('italic').checked });
  $('align').onchange = () => setDesign({ align: $('align').value });
  $('emphasize').onchange = () => setDesign({ emphasizeFirst: $('emphasize').checked });
  $('icon-pos').onchange = () => setDesign({ iconPos: $('icon-pos').value });
  $('cut-marks').onchange = () => setDesign({ cutMarks: $('cut-marks').checked });
  $('chain').onchange = () => {
    chainOn = $('chain').checked;
    writeFlag('chain', chainOn);
    syncForm();
    updatePreview();
  };
  $('copies').oninput = () => {
    syncForm();
    updatePreview();
  };
  $('center-marks').onchange = () => setDesign({ centerMarks: $('center-marks').checked });

  $('upload').onchange = () => {
    const file = $('upload').files[0];
    $('upload').value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      design.icon = 'upload';
      design.imageData = reader.result;
      saveDesign();
      loadImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  syncForm();
  loadImage(design.imageData);
}

async function printLabels() {
  const copies = copiesWanted();
  printing = true;
  stopRequested = false;
  updateButtons();
  const started = performance.now();
  let done = 0;
  try {
    await loadFont(design);
    for (let i = 1; i <= copies; i++) {
      $('print-state').textContent = `Printing ${i} of ${copies}…`;
      const s = await printer.requestStatus();
      if (s.errors.length) throw new Error(`Printer reports: ${s.errors.join(', ')}`);
      const area = PRINT_AREA[s.mediaWidthMm];
      if (!area) throw new Error(`Unsupported tape width: ${s.mediaWidthMm} mm`);
      tapeMm = s.mediaWidthMm;
      // Copies always chain; the last one feeds out to the cutter unless chain printing is on.
      const chained = chainOn || i < copies;
      const { lines } = renderDesign(area, chained);
      // With cut marks the cutter should land on the last mark, so no margin. Without them, keep the
      // printer's margin (it also draws its own cut mark there).
      const marginDots = marksOn() ? 0 : MARGIN_DOTS;
      const job = buildJob(lines, { mediaType: s.mediaType, widthMm: s.mediaWidthMm, chain: chained, marginDots });
      log(`Label ${i}/${copies}: ${lines.length} lines, ${job.length} bytes${chained ? ', chained' : ', feeds out'}`, 'info');
      await printer.printJob(job);
      done = i;
      parked = chained;
      writeFlag('parked', parked);
      log(`Label ${i}/${copies} printed`, 'info');
      if (stopRequested && i < copies) {
        log('Stopped by user', 'info');
        break;
      }
    }
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    $('print-state').textContent = `Done: ${done} label${done === 1 ? '' : 's'} in ${secs} s.`;
  } catch (err) {
    log(`Print failed: ${err.message}`, 'err');
    $('print-state').textContent = `Failed after ${done} label${done === 1 ? '' : 's'}: ${err.message}`;
  } finally {
    printing = false;
    syncForm();
    updatePreview();
  }
}

// Close off a chained strip: print just a cut mark and feed it out, so the cutter cuts on that mark.
async function feedOut() {
  printing = true;
  updateButtons();
  try {
    const s = await printer.requestStatus();
    if (s.errors.length) throw new Error(`Printer reports: ${s.errors.join(', ')}`);
    const area = PRINT_AREA[s.mediaWidthMm];
    if (!area) throw new Error(`Unsupported tape width: ${s.mediaWidthMm} mm`);
    const lines = canvasToLines(renderCutMark(area), area);
    log('Feed out: closing cut mark', 'info');
    await printer.printJob(buildJob(lines, { mediaType: s.mediaType, widthMm: s.mediaWidthMm, marginDots: 0 }));
    parked = false;
    writeFlag('parked', false);
    $('print-state').textContent = 'Fed out. Cut at the mark.';
  } catch (err) {
    log(`Feed out failed: ${err.message}`, 'err');
    $('print-state').textContent = `Feed out failed: ${err.message}`;
  } finally {
    printing = false;
    syncForm();
    updatePreview();
  }
}

if (!Printer.isSupported()) {
  $('unsupported').hidden = false;
  $('btn-connect').disabled = true;
}

$('btn-connect').onclick = async () => {
  try {
    await printer.connect();
    await printer.requestStatus();
  } catch (err) {
    log(`Connect failed: ${err.message}`, 'err');
  }
};

$('btn-disconnect').onclick = () => printer.disconnect();

$('btn-status').onclick = async () => {
  try {
    await printer.requestStatus();
  } catch (err) {
    log(`Status failed: ${err.message}`, 'err');
  }
};

$('btn-print').onclick = printLabels;
$('btn-feed').onclick = feedOut;
$('btn-stop').onclick = () => {
  stopRequested = true;
  $('btn-stop').hidden = true;
};
$('btn-clear-log').onclick = () => { logEl.innerHTML = ''; };

for (const [value, [name]] of Object.entries(COLOR_PRESETS)) {
  $('tape-colors').append(new Option(name, value));
}
$('tape-colors').value = localStorage.getItem('tapeColors') in COLOR_PRESETS ? localStorage.getItem('tapeColors') : 'auto';
$('tape-colors').onchange = () => {
  localStorage.setItem('tapeColors', $('tape-colors').value);
  updatePreview();
};

// Collapsible sections remember whether they were left open.
for (const id of ['more-options', 'printer-details']) {
  const el = $(id);
  try { el.open = localStorage.getItem(id) === 'open'; } catch { /* ignore */ }
  el.ontoggle = () => { try { localStorage.setItem(id, el.open ? 'open' : 'closed'); } catch { /* ignore */ } };
}

buildDesigner();
updatePreview();
log('Ready');
