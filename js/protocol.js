// Brother P-touch raster protocol helpers. See CLAUDE.md for the command reference.

// Byte sequences match a capture of Brother's own app (see CLAUDE.md).
export const CMD = {
  invalidate: new Uint8Array(100),                    // 100 x 0x00
  rasterMode: Uint8Array.of(0x1b, 0x69, 0x61, 0x01),
  initialize: Uint8Array.of(0x1b, 0x40),
  statusRequest: Uint8Array.of(0x1b, 0x69, 0x53),
  afterJob: Uint8Array.of(0x1b, 0x69, 0x61, 0xff),    // sent by Brother's app after each label
};

export const STATUS = { REPLY: 0x00, COMPLETED: 0x01, ERROR: 0x02, PHASE_CHANGE: 0x06 };

export const LINE_BYTES = 16; // 128 dots across the head

// Printable dots per tape width (mm, as reported in status byte 10).
// 12 mm is verified from the capture. Others are from Brother's PT-P710BT reference.
export const PRINT_AREA = {
  12: { offset: 32, dots: 64, verified: true },
  9: { offset: 39, dots: 50 },
  6: { offset: 48, dots: 32 },
  4: { offset: 52, dots: 24 }, // 3.5 mm tape
};

const STATUS_LEN = 32;
const HEADER = [0x80, 0x20, 0x42];

const ERRORS_1 = { 0x01: 'No tape', 0x02: 'Tape end', 0x04: 'Cutter jam', 0x08: 'Weak batteries', 0x40: 'High voltage adapter' };
const ERRORS_2 = { 0x01: 'Wrong tape', 0x10: 'Cover open', 0x20: 'Overheating' };

function describeErrors(e1, e2) {
  const names = [];
  for (const [bit, name] of Object.entries(ERRORS_1)) if (e1 & bit) names.push(name);
  for (const [bit, name] of Object.entries(ERRORS_2)) if (e2 & bit) names.push(name);
  if (!names.length && (e1 || e2)) names.push(`Unknown error 0x${e1.toString(16)}/0x${e2.toString(16)}`);
  return names;
}

const BATTERY = ['Full', 'Half', 'Low', 'Change batteries', 'AC adapter'];
const STATUS_TYPE = {
  0x00: 'Reply to status request',
  0x01: 'Printing completed',
  0x02: 'Error',
  0x03: 'IF mode finished',
  0x04: 'Power off',
  0x05: 'Notification',
  0x06: 'Phase change',
};

export function parseStatus(b) {
  return {
    battery: BATTERY[b[6]] ?? `Unknown (${b[6]})`,
    errorInfo1: b[8],
    errorInfo2: b[9],
    errors: describeErrors(b[8], b[9]),
    mediaWidthMm: b[10],
    mediaType: b[11],
    statusType: STATUS_TYPE[b[18]] ?? `Unknown (${b[18]})`,
    statusTypeCode: b[18],
    phaseType: b[19],
    notification: b[22],
  };
}

// Bluetooth can split or merge packets, so buffer the stream and resync on the header.
export class StatusParser {
  constructor(onPacket) {
    this.buf = [];
    this.onPacket = onPacket;
  }

  push(chunk) {
    this.buf.push(...chunk);
    for (;;) {
      const start = this._findHeader();
      if (start < 0) {
        // Keep a possible partial header at the end.
        this.buf = this.buf.slice(-2);
        return;
      }
      if (start > 0) this.buf = this.buf.slice(start);
      if (this.buf.length < STATUS_LEN) return;
      const packet = Uint8Array.from(this.buf.slice(0, STATUS_LEN));
      this.buf = this.buf.slice(STATUS_LEN);
      this.onPacket(packet);
    }
  }

  _findHeader() {
    for (let i = 0; i + HEADER.length <= this.buf.length; i++) {
      if (HEADER.every((h, j) => this.buf[i + j] === h)) return i;
    }
    return -1;
  }
}

// TIFF PackBits compression of one raster line.
export function packBits(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    let run = 1;
    while (i + run < src.length && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 2) {
      out.push((257 - run) & 0xff, src[i]);
      i += run;
    } else {
      let j = i;
      while (j < src.length && j - i < 128 && !(j + 1 < src.length && src[j] === src[j + 1])) j++;
      out.push(j - i - 1, ...src.slice(i, j));
      i = j;
    }
  }
  return out;
}

// Build a complete one-label job. `lines` is an array of 16-byte raster lines.
export function buildJob(lines, { mediaType, widthMm, cutMark = false }) {
  const n = lines.length;
  const bytes = [
    ...CMD.invalidate,
    ...CMD.rasterMode,
    ...CMD.initialize,
    // Print info. The line count here MUST equal the number of lines sent.
    0x1b, 0x69, 0x7a, 0x84, mediaType, widthMm, 0x00,
    n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff, 0x00, 0x00,
    0x1b, 0x69, 0x4b, 0x08,
    0x1b, 0x69, 0x4d, cutMark ? 0x40 : 0x00,
    0x1b, 0x69, 0x64, 0x1c, 0x00,
    0x4d, 0x02,
  ];
  for (const line of lines) {
    if (line.length !== LINE_BYTES) throw new Error(`Raster line must be ${LINE_BYTES} bytes`);
    const packed = packBits(line);
    bytes.push(0x47, packed.length & 0xff, packed.length >> 8, ...packed);
  }
  bytes.push(0x1a); // print + feed, last page
  return Uint8Array.from(bytes);
}

export function toHex(bytes) {
  return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join(' ');
}
