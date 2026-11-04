import { Printer } from './printer.js';
import { PRINT_AREA, buildJob } from './protocol.js';
import { renderText, drawPreview } from './render.js';

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
let tapeColors = {}; // preview colors, once the printer reports them

function updateButtons() {
  $('conn-state').textContent = connected ? 'Connected' : 'Disconnected';
  $('conn-state').className = `pill ${connected ? 'on' : 'off'}`;
  $('btn-connect').disabled = connected;
  $('btn-disconnect').disabled = !connected || printing;
  $('btn-status').disabled = !connected || printing;
  $('btn-print').disabled = !connected || printing || !$('label-text').value.trim();
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
    const colors = { tape: s.tapeColor.css, ink: s.textColor.css };
    if (colors.tape && colors.ink && (colors.tape !== tapeColors.tape || colors.ink !== tapeColors.ink)) {
      tapeColors = colors;
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

function updatePreview() {
  const text = $('label-text').value.trim();
  const area = PRINT_AREA[tapeMm];
  const lines = text ? renderText(text, area) : [];
  drawPreview($('preview'), lines, area, tapeColors);
  const mm = (lines.length / 180 * 25.4).toFixed(1);
  $('preview-info').textContent = text
    ? `${tapeMm} mm tape${area.verified ? '' : ' (print area not yet verified)'} · ${lines.length} lines ≈ ${mm} mm of text`
    : '';
  updateButtons();
}

async function printLabels() {
  const text = $('label-text').value.trim();
  const copies = Math.max(1, Math.min(50, parseInt($('copies').value, 10) || 1));
  const cutMark = $('cut-mark').checked;
  printing = true;
  stopRequested = false;
  updateButtons();
  const started = performance.now();
  let done = 0;
  try {
    for (let i = 1; i <= copies; i++) {
      $('print-state').textContent = `Printing ${i} of ${copies}…`;
      const s = await printer.requestStatus();
      if (s.errors.length) throw new Error(`Printer reports: ${s.errors.join(', ')}`);
      const area = PRINT_AREA[s.mediaWidthMm];
      if (!area) throw new Error(`Unsupported tape width: ${s.mediaWidthMm} mm`);
      tapeMm = s.mediaWidthMm;
      const lines = renderText(text, area);
      const job = buildJob(lines, { mediaType: s.mediaType, widthMm: s.mediaWidthMm, cutMark });
      log(`Label ${i}/${copies}: ${lines.length} lines, ${job.length} bytes`, 'info');
      await printer.printJob(job);
      done = i;
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
    updateButtons();
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
$('btn-stop').onclick = () => {
  stopRequested = true;
  $('btn-stop').hidden = true;
};
$('label-text').oninput = updatePreview;
$('btn-clear-log').onclick = () => { logEl.innerHTML = ''; };

updatePreview();
log('Ready');
