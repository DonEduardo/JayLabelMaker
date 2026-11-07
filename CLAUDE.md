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
- Mac: `python3 tools/serve.py` (port 8000), then open `http://localhost:8000` in Chrome. It sends
  `Cache-Control: no-store`; plain `python3 -m http.server` let Chrome keep stale JS modules after edits.
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

### Verified from capture of Brother's app (2026-11-03, 12 mm tape, PT-P300BT)
Full HCI snoop log; both jobs decoded byte-for-byte. Printer BT address `a0:66:10:95:64:a7`, RFCOMM channel 1.
Exact job sent (2365 bytes, written in one burst over ~50 ms, no throttling):
```
00 x 100
1B 69 61 01                              raster mode (sent BEFORE 1B 40)
1B 40                                    initialize
1B 69 7A 84 01 0C 00 96 00 00 00 00 00   flags 0x84, laminated, 12 mm, 0x96 = 150 lines
1B 69 4B 08                              bit 3 = chain printing OFF (Brother ref: feed the label out after printing)
1B 69 4D 00                              label 1 sent 00, label 2 sent 40 (Brother ref: bit 6 = "auto cut"; effect on P300BT unverified)
1B 69 64 1C 00
4D 02                                    PackBits compression IS used
47 n1 n2 [packbits] x 150                every line decompresses to 16 bytes; line count == header count
1A
```
- Printable area on 12 mm tape: dots 32..95 of the 128 (64 dots, 32-dot blank margin on each side).
- Before each job the app sends `1B 69 53` twice (one reply each, status type 00).
- After the data, the printer pushes status on its own (no request needed):
  1. ~0.15 s: type 06 phase change, phase 01 (printing)
  2. ~3 s: type 01 **printing completed**
  3. immediately after: type 06 phase change, phase 00 (back to receiving)
- Then the app sends `1B 69 61 FF` (purpose unknown; copy it to be safe).
- Status byte 4 = 0x72 (model id), byte 15 echoes the various-mode byte (`1B 69 4D`).
- The two captured jobs differ ONLY in `1B 69 4D` (00 vs 40): same 150 lines, same margin. Label 2 (40) took
  3.20 s from "printing" to "completed" vs 3.04 s, so roughly 3 mm more tape at ~20 mm/s. Whether 40 prints a
  cut mark, adds feed, or both is unverified: check the physical labels.
- One Bluetooth connection was kept open for both labels.
- Status bytes 24/25 = tape color / text color (Brother's codes). Genuine white-on-black 12 mm reports `08 01`.
  A knockoff black-on-yellow cartridge reports `01 08` (white tape, black text), so knockoff colors can be
  wrong. It prints fine with our app (Brother's app rejected knockoffs).
- 2026-11-03: replaying this exact job from the Mac (Python + PyObjC IOBluetooth, RFCOMM channel 1)
  printed 2 labels back to back, each with the same status sequence (~3.3 s per label).
- Printer SDP records: SPP (0x1101) on RFCOMM **channel 1**; "Wireless iAP" (Apple MFi) on channel 2,
  which spams `FF 55 …`. macOS exposes no `/dev/cu.PT-P300BT*` device.
- Chrome 156 on macOS: `port.open()` fails with "Failed to open serial port". `chrome://device-log` says
  "Failed to connect socket ... SDP query timeout" ~8 s after the link comes up. The same SDP query
  (with or without the 0x1101 UUID filter) finishes in ~0.1 s from Python, so this looks like a Chrome-on-Mac bug.
  Confirmed: https://issues.chromium.org/issues/569041183 (filed 2026-10-03, open). On macOS 26, IOBluetooth never
  calls back `performSDPQuery:` when there's no baseband (ACL) link yet. Works if the link is already up when Chrome
  queries (brltty fixed the same bug that way: https://github.com/brltty/brltty/pull/569). Possible workaround to
  test: hold an ACL link from Python (`openConnection`, no RFCOMM channel), then open the port in Chrome.
- 2026-11-05: after updating to macOS 27.2 the web app printed from Chrome on both Macs with no workaround.
  **2026-11-07: the bug is back** (same "SDP query timeout" in `chrome://device-log`, while Python reached the
  printer fine). So the update didn't fix it; it's intermittent. Testing `tools/hold_link.py` (hold the ACL link,
  then Connect in Chrome): the link came up, but the result is unknown (user rebooted before trying).

### 32-byte status packet
Header starts `80 20 42 30 …` (0x80 head mark, 0x20 = size 32, 'B', '0').
Offsets as used by stecman's script (verify against captures):
- 6 battery (0 full, 1 half, 2 low, 3 change, 4 AC)
- 7 extended error, 8 error info 1, 9 error info 2
- 10 media width (mm), 11 media type
- 18 status type: 00 reply to request, 01 printing completed, 02 error, 03 IF mode finished,
  04 power off, 05 notification, 06 phase change
- 19 phase type, 22 notification

### Feed, cutter, and chain printing (tape tests 2026-11-06, verified)
Short test labels from `tools/ptest.py`, 12 mm tape, one connection per run (connection reuse made no difference).
- **Chain printing = `1B 69 4B` bit 3.** `4B 00` = chain ON: the label stays inside and the next label prints
  right behind it. `4B 08` (what our app and Brother's captured jobs send) = chain OFF.
- **`4B 08` + `4D 00` (our app today):** the label stays inside after printing, then the NEXT job first feeds ~25 mm
  (head-to-cutter distance) before printing. So every label costs ~25 mm of blank.
- **`4D 40`** (bit 6, Brother: "auto cut"): at the front of the label the printer draws its own small cut mark
  (two short dots) inside the margin, and after printing it feeds the label out to the cutter.
- **Margin `1B 69 64 n 00`** (dots, 180 dpi) is added at BOTH ends of a label. The printer's own cut mark sits in
  the front margin, so margin 0 removes it. Margin 0 is accepted (no error).
- Gap between chained labels (`4B 00`): ~4-5 mm at margin 28; **2.5 mm at margin 0** (calipers, trailing mark to
  next label's first mark; our marks are at the image ends, so this is all printer feed, apparently its minimum).
  Calipers also matched a 17-line (2.4 mm) span in our image at 2.5 mm, so 180 dpi along the tape checks out.
- Design idea: chained labels share ONE cut mark (each label draws only its leading mark); use a 2.5 mm drawn
  leading gap so both ends of each label get equal blank (drawn 2.5 mm + mark | content | printer's 2.5 mm).
- Where the cutter lands past our trailing mark on a fed-out label: ~5.0 mm at margin 28 (calipers), ~2 mm at
  margin 14, right on the mark at margin 0 (the 2-dot mark got cut through). So the cut lands ~one margin past
  the end of the image.
- The first label of any strip has a ~25 mm leader (the head sits ~25 mm behind the blade); unavoidable.
- Recipe for a chained run (e.g. 5 spice labels): `4B 00`/`4D 00`, margin 0 for every label but the last; last label
  `4B 08`/`4D 40`, margin 0 (verified: the cutter cuts on the last mark). Brother's app seems to differ (its "chain on"
  label 1 was `4B 08`/`4D 00`), but that doesn't matter for us.
- Verified with calipers: a fed-out label (`4B 08`/`4D 40`) at margin 0 is cut right through our trailing 2-dot mark
  (last bar to cut edge ~2.5 mm, mark partly visible at the edge). So margin 0 = cut on the mark.
- Unexplained: user once saw a label (margin 28, `4B 00`, followed by a `4D 40` label) without its trailing mark.
- Mac testing notes: macOS 27.2 now creates `/dev/cu.PT-P300BT0358`, but it gave no replies; the direct
  IOBluetooth RFCOMM route works. Opening fails with `0xe00002bc` while Chrome holds the printer (quit Chrome)
  or for ~2 s after the previous connection closes (retry).
- 2026-11-07: built in the web app (chain switch, Feed out, shared cut marks, margin 0 with marks, fixed length
  counts the 2.5 mm gap, copies always chain). User tested on tape: works well.

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
