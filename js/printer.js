// Printer session: owns the transport, parses status, and runs one job at a time,
// waiting for "printing completed" before the next one may start.

import { SerialTransport } from './serial.js';
import { CMD, STATUS, StatusParser, parseStatus, toHex } from './protocol.js';

const STATUS_TIMEOUT_MS = 3000;
const PRINT_TIMEOUT_MS = 30000;
const READY_TIMEOUT_MS = 2000;

export class Printer {
  constructor({ log, onStatus, onConnectionChange }) {
    this.log = log;
    this.onStatus = onStatus || (() => {});
    this.onConnectionChange = onConnectionChange || (() => {});
    this.waiters = new Set();
    this.lastStatus = null;
    this.parser = new StatusParser((packet) => this._onPacket(packet));
    this.transport = new SerialTransport({
      onData: (bytes) => {
        log(`RX ${toHex(bytes)}`, 'rx');
        this.parser.push(bytes);
      },
      onLog: log,
      onClose: () => {
        this._failAll(new Error('Connection closed'));
        this.onConnectionChange(false);
      },
    });
  }

  static isSupported() {
    return SerialTransport.isSupported();
  }

  async connect() {
    await this.transport.connect();
    this.onConnectionChange(true);
  }

  disconnect() {
    return this.transport.disconnect();
  }

  async send(bytes, label) {
    const hex = bytes.length > 48 ? `${toHex(bytes.subarray(0, 48))} … (${bytes.length} bytes)` : toHex(bytes);
    this.log(`TX ${label ? label + ': ' : ''}${hex}`, 'tx');
    await this.transport.write(bytes);
  }

  async requestStatus() {
    const reply = this._waitFor((s) => s.statusTypeCode === STATUS.REPLY, STATUS_TIMEOUT_MS, 'status reply');
    try {
      await this.send(CMD.statusRequest, 'status request');
    } catch (err) {
      reply.cancel();
      throw err;
    }
    return reply;
  }

  // Send one complete job and wait until the printer reports it is finished.
  async printJob(job) {
    // Register both waiters before sending: "completed" and "ready" can arrive in the same read.
    const completed = this._waitFor((s) => s.statusTypeCode === STATUS.COMPLETED, PRINT_TIMEOUT_MS, 'printing completed');
    const ready = this._waitFor(
      (s) => s.statusTypeCode === STATUS.PHASE_CHANGE && s.phaseType === 0x00,
      PRINT_TIMEOUT_MS + READY_TIMEOUT_MS,
      'ready',
    );
    ready.catch(() => {});
    try {
      await this.send(job, 'job');
      await completed;
    } catch (err) {
      completed.cancel();
      ready.cancel();
      throw err;
    }
    // Brother's app gets "ready" right after "completed". Don't fail if it's missing.
    const gotReady = await Promise.race([ready.then(() => true, () => false), sleep(READY_TIMEOUT_MS).then(() => false)]);
    ready.cancel();
    if (!gotReady) this.log('No "ready" phase change after printing; continuing', 'err');
    await this.send(CMD.afterJob, 'after job');
  }

  _onPacket(packet) {
    const s = parseStatus(packet);
    this.lastStatus = s;
    const extra = s.statusTypeCode === STATUS.PHASE_CHANGE ? ` (phase ${s.phaseType})` : '';
    this.log(`Status: ${s.statusType}${extra}${s.errors.length ? ' — ' + s.errors.join(', ') : ''}`, s.errors.length ? 'err' : 'rx');
    this.onStatus(s);
    if (s.statusTypeCode === STATUS.ERROR) {
      this._failAll(new Error(`Printer error: ${s.errors.join(', ') || 'unknown'}`));
      return;
    }
    for (const w of [...this.waiters]) {
      if (w.match(s)) w.done(s);
    }
  }

  _waitFor(match, timeoutMs, what) {
    let w;
    const promise = new Promise((resolve, reject) => {
      w = { match };
      const finish = (fn, value) => {
        clearTimeout(w.timer);
        this.waiters.delete(w);
        fn(value);
      };
      w.done = (s) => finish(resolve, s);
      w.fail = (err) => finish(reject, err);
      w.timer = setTimeout(() => w.fail(new Error(`Timed out waiting for ${what}`)), timeoutMs);
    });
    this.waiters.add(w);
    promise.cancel = () => {
      clearTimeout(w.timer);
      this.waiters.delete(w);
    };
    return promise;
  }

  _failAll(err) {
    for (const w of [...this.waiters]) w.fail(err);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
