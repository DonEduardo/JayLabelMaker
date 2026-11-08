#!/usr/bin/env python3
"""Tape tests for the PT-P300BT from the Mac, over RFCOMM channel 1 (PyObjC IOBluetooth).

Run from the project folder (quit Chrome first, or it holds the printer):
    .venv/bin/python tools/ptest.py status
    .venv/bin/python tools/ptest.py print BARS:4D[:4B][,BARS:4D[:4B]...] MARGIN_DOTS [marks]

Each label is a few bars across the tape (count them to tell labels apart), optionally between
dotted cut marks with a 1.5 mm gap. All labels in one command go over one connection.
  4D: 1B 69 4D byte, hex (40 = printer cut mark + feed out at the end, 00 = no feed out)
  4B: 1B 69 4B byte, hex (00 = chain printing on, 08 = off; default 08)
  MARGIN_DOTS: 1B 69 64 value, dots at 180 dpi (28 = ~4 mm, 0 = none)
Example, 2 chained labels then one that feeds out, no margin:
    .venv/bin/python tools/ptest.py print 3:00:00,4:00:00,5:40:08 0 marks
Findings from these tests are in PROTOCOL.md ("Feed, cutter and chain printing").
"""
import sys
import time

import IOBluetooth
from Foundation import NSDate, NSObject, NSRunLoop

ADDRESS = "a0-66-10-95-64-a7"
T0 = time.monotonic()
rx = bytearray()


def log(msg):
    print(f"{time.monotonic() - T0:7.3f}  {msg}", flush=True)


def pump(seconds):
    NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(seconds))


class Delegate(NSObject):
    def rfcommChannelData_data_length_(self, channel, data, length):
        try:
            chunk = bytes(data[:length])
        except TypeError:
            chunk = bytes(data)[:length]
        rx.extend(chunk)

    def rfcommChannelClosed_(self, channel):
        log("channel closed")


def packets():
    """Pull complete 32-byte status packets out of rx (resync on 80 20 42)."""
    out = []
    while True:
        i = rx.find(b"\x80\x20\x42")
        if i < 0:
            del rx[:-2]
            return out
        del rx[:i]
        if len(rx) < 32:
            return out
        out.append(bytes(rx[:32]))
        del rx[:32]


TYPES = {0: "reply", 1: "COMPLETED", 2: "ERROR", 3: "IF mode finished", 4: "power off", 5: "notification", 6: "phase change"}


def describe(p):
    t = TYPES.get(p[18], p[18])
    extra = f" phase {p[19]}" if p[18] == 6 else ""
    err = f" errors {p[8]:02x}/{p[9]:02x}" if (p[8] or p[9]) else ""
    return f"status: {t}{extra}{err} | width {p[10]} mm, media {p[11]:02x}, byte15 {p[15]:02x}"


def wait_for(pred, timeout):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        pump(0.05)
        for p in packets():
            log(describe(p))
            if p[18] == 2:
                return p
            if pred(p):
                return p
    return None


def write(channel, data):
    mtu = channel.getMTU()
    for i in range(0, len(data), mtu):
        part = data[i:i + mtu]
        r = channel.writeSync_length_(part, len(part))
        if r != 0:
            raise SystemExit(f"write failed: 0x{r & 0xFFFFFFFF:08x}")


def packbits(src):
    out = bytearray()
    i = 0
    while i < len(src):
        run = 1
        while i + run < len(src) and run < 128 and src[i + run] == src[i]:
            run += 1
        if run >= 2:
            out += bytes([(257 - run) & 0xFF, src[i]])
            i += run
        else:
            j = i
            while j < len(src) and j - i < 128 and not (j + 1 < len(src) and src[j] == src[j + 1]):
                j += 1
            out += bytes([j - i - 1]) + bytes(src[i:j])
            i = j
    return bytes(out)


def line(dots):
    """dots: set of head dot indexes (0..127) to print."""
    b = bytearray(16)
    for d in dots:
        b[d // 8] |= 0x80 >> (d % 8)
    return bytes(b)


PRINT = range(32, 96)  # 12 mm tape printable dots


def image(bars, marks):
    blank = line(())
    mark = line(d for d in PRINT if (d - 32) % 7 < 4)
    bar = line(range(40, 88))
    body = [blank] * 6
    for _ in range(bars):
        body += [bar] * 6 + [blank] * 6
    gap = [blank] * 11  # 1.5 mm
    if marks:
        return [mark] * 2 + gap + body + gap + [mark] * 2
    return body


def job(lines, various, margin, advanced=0x08):
    n = len(lines)
    b = bytearray(100)
    b += bytes([0x1B, 0x69, 0x61, 0x01, 0x1B, 0x40])
    b += bytes([0x1B, 0x69, 0x7A, 0x84, 0x01, 0x0C, 0x00]) + n.to_bytes(4, "little") + bytes([0, 0])
    b += bytes([0x1B, 0x69, 0x4B, advanced, 0x1B, 0x69, 0x4D, various, 0x1B, 0x69, 0x64, margin & 0xFF, margin >> 8])
    b += bytes([0x4D, 0x02])
    for ln in lines:
        p = packbits(ln)
        b += bytes([0x47, len(p) & 0xFF, len(p) >> 8]) + p
    b += bytes([0x1A])
    return bytes(b)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    device = IOBluetooth.IOBluetoothDevice.deviceWithAddressString_(ADDRESS)
    delegate = Delegate.alloc().init()
    log("opening RFCOMM channel 1...")
    result, channel = device.openRFCOMMChannelSync_withChannelID_delegate_(None, 1, delegate)
    if result != 0:
        raise SystemExit(f"open failed: 0x{result & 0xFFFFFFFF:08x}")
    log(f"open, MTU {channel.getMTU()}")
    try:
        write(channel, bytes([0x1B, 0x69, 0x53]))
        if not wait_for(lambda p: p[18] == 0, 3):
            raise SystemExit("no status reply")
        if cmd == "print":
            # print BARS:VARIOUS[,BARS:VARIOUS...] MARGIN [marks]: all jobs over ONE connection.
            specs = [tuple(x.split(":")) for x in sys.argv[2].split(",")]
            margin = int(sys.argv[3])
            marks = len(sys.argv) > 4 and sys.argv[4] == "marks"
            for k, spec in enumerate(specs):
                bars, various = int(spec[0]), int(spec[1], 16)
                advanced = int(spec[2], 16) if len(spec) > 2 else 0x08
                if k:
                    write(channel, bytes([0x1B, 0x69, 0x53]))
                    wait_for(lambda p: p[18] == 0, 3)
                lines = image(bars, marks)
                data = job(lines, various, margin, advanced)
                log(f"job: {bars} bars, 4B {advanced:02x}, 4D {various:02x}, margin {margin} dots ({margin / 180 * 25.4:.2f} mm), "
                    f"marks {marks}, {len(lines)} lines ({len(lines) / 180 * 25.4:.1f} mm), {len(data)} bytes")
                write(channel, data)
                done = wait_for(lambda p: p[18] == 1, 30)
                if not (done and done[18] == 1):
                    log("did NOT complete")
                    break
                wait_for(lambda p: p[18] == 6 and p[19] == 0, 2)
                write(channel, bytes([0x1B, 0x69, 0x61, 0xFF]))
                pump(0.3)
                log("done")
    finally:
        channel.closeChannel()
        pump(0.3)


if __name__ == "__main__":
    main()
