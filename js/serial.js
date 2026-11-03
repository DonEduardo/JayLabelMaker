// Web Serial transport for the PT-P300BT over Bluetooth Classic (SPP/RFCOMM).

export const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';

export class SerialTransport {
  constructor({ onData, onLog, onClose } = {}) {
    this.port = null;
    this.reader = null;
    this.onData = onData || (() => {});
    this.onLog = onLog || (() => {});
    this.onClose = onClose || (() => {});
  }

  static isSupported() {
    return 'serial' in navigator;
  }

  async connect() {
    // The SPP filter lets Chrome list paired Bluetooth serial devices.
    this.port = await navigator.serial.requestPort({
      allowedBluetoothServiceClassIds: [SPP_UUID],
      filters: [{ bluetoothServiceClassId: SPP_UUID }],
    });
    // baudRate is required by the API but ignored over Bluetooth.
    await this.port.open({ baudRate: 9600 });
    this.onLog('Port opened', 'info');
    this._readLoop();
  }

  async _readLoop() {
    while (this.port?.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value?.length) this.onData(value);
        }
      } catch (err) {
        this.onLog(`Read error: ${err.message}`, 'err');
      } finally {
        this.reader.releaseLock();
        this.reader = null;
      }
      if (!this.port) break;
    }
    this.onClose();
  }

  async write(bytes) {
    if (!this.port?.writable) throw new Error('Not connected');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect() {
    const port = this.port;
    this.port = null;
    try { await this.reader?.cancel(); } catch {}
    try { await port?.close(); } catch {}
    this.onLog('Port closed', 'info');
  }
}
