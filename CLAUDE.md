# P-touch Cube Label App

Label-printing web app for a **Brother PT-P300BT** (P-touch Cube), replacing Brother's mobile app.
Printing works reliably on Android and macOS, including long runs of chained labels.

**Protocol, status packets, feed/cutter/chain behavior and platform notes: see [PROTOCOL.md](PROTOCOL.md).**
Keep it limited to verified facts; put anything untested in its "Not verified" section.

## Architecture
- Static web app (PWA) using the **Web Serial API** over Bluetooth Classic (SPP/RFCOMM).
- Runs in Chrome on **Android** and Chrome/Edge on **macOS**. Needs a secure context (HTTPS or `localhost`).
- Hosted on **GitHub Pages**: deploy = push to `main`. Live: https://doneduardo.github.io/JayLabelMaker/
- The printer must be paired with the OS first; then `navigator.serial.requestPort()` lists it.

## Code map
- `js/serial.js`: Web Serial transport.
- `js/protocol.js`: job builder, PackBits, status parser, print areas, margin/gap constants.
- `js/printer.js`: session; one job at a time, waits for "printing completed" + ready.
- `js/render.js`: canvas to raster lines, and the preview.
- `js/design.js`: label designer (text, fonts, graphics, QR, borders, cut marks).
- `js/app.js`: UI, chain printing, copies, Feed out.
- `tools/ptest.py`: Python test printing over IOBluetooth on the Mac. `tools/hold_link.py`: holds the ACL link
  (an untested workaround for the Chrome-on-Mac SDP bug).

## Dev workflow
- Mac: `python3 tools/serve.py` (port 8000, sends `Cache-Control: no-store`), then open `http://localhost:8000`
  in Chrome. Plain `python3 -m http.server` let Chrome keep stale JS modules.
- Android during dev: USB-connect the phone and use `chrome://inspect` port forwarding, so the phone's
  `localhost:8000` maps to the Mac.
- Known issue: Chrome on macOS intermittently fails to open the port (Chromium bug 569041183, details in PROTOCOL.md).
