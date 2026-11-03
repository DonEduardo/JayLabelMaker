# P-touch Cube Label App

Custom label-printing app for a **Brother PT-P300BT** (P-touch Cube), replacing Brother's mobile app.

## Goals
- Reliable printing: many labels in a row, with no freezes or power-cycling.
- Runs on **Android** (Chrome) and **macOS** (Chrome/Edge).
- Later: a label designer (text, fonts, icons, live preview).

## Architecture decision
- **Static web app (PWA) using the Web Serial API over Bluetooth Classic (RFCOMM/SPP).**
  - Desktop Chrome 117+ supports Web Serial to paired Bluetooth Classic devices.
  - Chrome on Android supports it since 2025. **Caveat:** `connect`/`disconnect` events
    and `port.connected` are NOT reliable on Android, so detect dead links with
    status-request timeouts instead.
- Web Serial needs a **secure context** (HTTPS or `localhost`). A plain `http://192.168.x.x` will NOT work.
- Hosting: **GitHub Pages** (free HTTPS; deploy = push to `main`; free plan needs a public repo).
  Alternatives considered: Cloudflare Pages (works with private repos), Raspberry Pi + `tailscale serve`.
- The printer must be **paired with the OS first**. Then `navigator.serial.requestPort()` shows it.
  SPP UUID: `00001101-0000-1000-8000-00805f9b34fb`. `baudRate` is required by the API but irrelevant over BT.
- Native apps (Kotlin, Swift/Python) only if the web route hits a wall.

## Dev workflow
- Mac: `python3 -m http.server 8000` in the project folder, then open `http://localhost:8000` in Chrome.
- Android testing during dev: USB-connect the phone and use `chrome://inspect` port forwarding on the Mac,
  so the phone's `localhost:8000` maps to the Mac (still counts as secure).
- For fast protocol iteration, prefer a **Python test script** (pyserial) against the macOS
  serial device (`/dev/cu.PT-P300BT*`) if macOS exposes one. Get printing reliable there
  first, then port the logic to JS.

## Protocol (Brother P-touch raster / "PTCBP")
Reference: stecman's reverse-engineering gist:
https://gist.github.com/stecman/ee1fd9a8b1b6f0fdd170ee87ba2ddafd
Also close to Brother's published "Raster Command Reference" for PT-P710BT / PT-P750W / PT-E550W.

Job sequence, as sent by the official app (from captures):
```
00 x 64            invalidate / flush buffer
1B 40              initialize
1B 69 61 01        switch to raster mode
1B 69 7A n1..n10   print info: n1 valid-flags, n2 media type, n3 width mm (0x0C = 12mm),
                   n4 length (0 = continuous), n5..n8 RASTER LINE COUNT (uint32 LE), n9 page, n10 0
                   e.g. 1B 69 7A C4 01 0C 00 08 01 00 00 00 00  -> 0x0108 = 264 lines
1B 69 4B 08        advanced mode (chain printing off)
1B 69 4D 00        various mode (auto-cut off, mirror off)
1B 69 64 1C 00     margin/feed amount
4D 02              compression = TIFF/PackBits (verify whether P300BT honours it)
47 n1 n2 [data]    one raster line (len = n1 + n2*256); 1 line = 128 dots = 16 bytes uncompressed
                   (5A = all-blank line, if supported)
1A                 print + feed, LAST page  (0C = print, more pages follow; do NOT end with 0C)
```
- Image: 1-bit, 128 px across the head, sent line by line along the tape. Horizontal labels
  need rotating 90°. The image also needs a horizontal mirror with the settings above.
- 12 mm tape: roughly the outer 30 px on each side of the 128 px head do not print (verify).
- Status request: `1B 69 53` -> 32-byte status reply.

### 32-byte status packet
Header starts `80 20 42 30 …` (0x80 head mark, 0x20 = size 32, 'B', '0').
Offsets as used by stecman's script (verify against captures):
- 6 battery (0 full, 1 half, 2 low, 3 change, 4 AC)
- 7 extended error, 8 error info 1, 9 error info 2
- 10 media width (mm), 11 media type
- 18 status type: 00 reply to request, 01 printing completed, 02 error, 03 IF mode finished,
  04 power off, 05 notification, 06 phase change
- 19 phase type, 22 notification

## Known problem from the earlier attempt
Symptoms: sometimes prints one label then freezes, needing a power-button press. Sometimes BT won't connect.
The user recalls reading status but **never getting a "printing completed"**, with things hanging there.
stecman's script also saw the printer enter an error state after printing.

Hypotheses, most likely first:
1. **Raster line count mismatch.** Lines actually sent ≠ count in `1B 69 7A`, so the printer
   waits for more data and never completes.
2. **Ending the job with `0C` instead of `1A`**, so the printer waits for another page.
3. **Status framing bugs.** BT splits or merges the 32-byte packets. Buffer the RX stream
   and resync on the `80 20 42` header; never assume one read = one packet.
4. **An error status instead of completion** (wrong width/media in `1B 69 7A`, tape/cover issue)
   while the code only waits for "completed".
Also: always read and drain status replies, and don't close the port mid-print. Start every job
with flush + `1B 40`, throttle writes, and only start the next job after "printing completed"
(and probably the "phase change" back to receiving).

## Ground truth: capture the official app
1. Android: Developer options → enable **Bluetooth HCI snoop log**; toggle BT off/on.
2. In Brother's app, print one label, **wait until fully finished**, then print a second.
3. Pull the log (`adb bugreport`, or the file in the btsnoop path) and open it in Wireshark
   or `tshark`, filtering on `btrfcomm` / `btspp`.
4. Look at: the exact init bytes, the raster line count vs. lines sent, the end-of-job command,
   and **every status packet the printer sends after printing**, plus their timing.

## Build plan
1. Diagnostic tool (Python first, then a web page): connect, request status, print a test
   pattern, log every byte in both directions with timestamps, and enforce strict job sequencing.
2. Fix printing until 10+ labels in a row work reliably.
3. Web app: Web Serial transport, protocol module, then the label designer and preview, then a PWA manifest
   and service worker, then deploy to GitHub Pages.
