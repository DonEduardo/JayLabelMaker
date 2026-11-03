import { SerialTransport } from './serial.js';
import { CMD, StatusParser, parseStatus, toHex } from './protocol.js';

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

function setConnected(on) {
  $('conn-state').textContent = on ? 'Connected' : 'Disconnected';
  $('conn-state').className = `pill ${on ? 'on' : 'off'}`;
  $('btn-connect').disabled = on;
  $('btn-disconnect').disabled = !on;
  $('btn-status').disabled = !on;
}

function showStatus(s) {
  const rows = {
    'Status': s.statusType,
    'Battery': s.battery,
    'Tape width': `${s.mediaWidthMm} mm`,
    'Media type': `0x${s.mediaType.toString(16)}`,
    'Errors': `0x${s.errorInfo1.toString(16)} / 0x${s.errorInfo2.toString(16)}`,
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

const parser = new StatusParser((packet) => {
  const s = parseStatus(packet);
  log(`Status: ${s.statusType}`, 'rx');
  showStatus(s);
});

const transport = new SerialTransport({
  onData: (bytes) => {
    log(`RX ${toHex(bytes)}`, 'rx');
    parser.push(bytes);
  },
  onLog: log,
  onClose: () => setConnected(false),
});

async function send(bytes, label) {
  log(`TX ${label ? label + ': ' : ''}${toHex(bytes)}`, 'tx');
  await transport.write(bytes);
}

if (!SerialTransport.isSupported()) {
  $('unsupported').hidden = false;
  $('btn-connect').disabled = true;
}

$('btn-connect').onclick = async () => {
  try {
    await transport.connect();
    setConnected(true);
  } catch (err) {
    log(`Connect failed: ${err.message}`, 'err');
  }
};

$('btn-disconnect').onclick = () => transport.disconnect();

$('btn-status').onclick = async () => {
  try {
    await send(CMD.invalidate, 'invalidate');
    await send(CMD.initialize, 'init');
    await send(CMD.statusRequest, 'status request');
  } catch (err) {
    log(`Send failed: ${err.message}`, 'err');
  }
};

$('btn-clear-log').onclick = () => { logEl.innerHTML = ''; };

log('Ready');
