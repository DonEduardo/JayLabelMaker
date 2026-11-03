// Brother P-touch raster protocol helpers. See CLAUDE.md for the command reference.

export const CMD = {
  invalidate: new Uint8Array(64),            // 64 x 0x00
  initialize: Uint8Array.of(0x1b, 0x40),
  statusRequest: Uint8Array.of(0x1b, 0x69, 0x53),
};

const STATUS_LEN = 32;
const HEADER = [0x80, 0x20, 0x42];

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

export function toHex(bytes) {
  return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join(' ');
}
