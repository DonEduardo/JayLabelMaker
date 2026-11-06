#!/usr/bin/env python3
"""Hold a Bluetooth link to the printer open so Chrome on macOS can open the port.

Workaround for the Chrome-on-Mac bug (https://issues.chromium.org/issues/569041183):
Chrome's SDP query never finishes if there's no Bluetooth link to the printer yet.
This script brings the link up (no RFCOMM channel, so it doesn't claim the port)
and keeps it up. Then click Connect in the web app.

Usage (from the project folder):
    .venv/bin/python tools/hold_link.py            # default printer address
    .venv/bin/python tools/hold_link.py AA:BB:...  # another address

Ctrl+C to stop.
"""
import sys
import time

import IOBluetooth
from Foundation import NSDate, NSRunLoop

DEFAULT_ADDRESS = "a0:66:10:95:64:a7"  # our PT-P300BT


def pump(seconds):
    """Let macOS deliver Bluetooth events while we wait."""
    NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(seconds))


def main():
    address = (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ADDRESS).replace(":", "-")
    device = IOBluetooth.IOBluetoothDevice.deviceWithAddressString_(address)
    if device is None:
        sys.exit(f"Bad address: {address}")
    print(f"Printer: {device.name() or '(unknown name)'} {address}"
          f" paired={bool(device.isPaired())}")

    was_up = False
    started = None
    try:
        while True:
            up = bool(device.isConnected())
            if up and not was_up:
                started = time.monotonic()
                print(f"{time.strftime('%H:%M:%S')}  Link is UP. Now click Connect in Chrome.")
            elif not up and was_up:
                held = time.monotonic() - started
                print(f"{time.strftime('%H:%M:%S')}  Link dropped after {held:.0f} s. Reconnecting...")
            if not up:
                # Blocks until the link is up or the attempt fails (printer off, out of range).
                result = device.openConnection()
                if result != 0:
                    print(f"{time.strftime('%H:%M:%S')}  Connect failed (IOReturn 0x{result & 0xFFFFFFFF:08x}). "
                          "Is the printer on? Retrying in 3 s.")
                    pump(3)
            was_up = up
            pump(0.5)
    except KeyboardInterrupt:
        print("\nStopping. Leaving any link Chrome is using alone.")


if __name__ == "__main__":
    main()
