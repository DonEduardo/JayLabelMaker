# Brother PT-P300BT (P-touch Cube) protocol reference

Verified working notes for printing on the PT-P300BT, from a Bluetooth capture of Brother's app (2026-11-03),
replaying it from Python, tape tests with calipers (2026-11-06), and the working web app (`js/protocol.js`,
`js/printer.js`, `js/render.js`, `js/design.js`). Everything here works unless it is in "Not verified" at the end.

Background reading: Brother's "Raster Command Reference" for PT-P710BT / PT-P750W / PT-E550W (close match),
and stecman's gist https://gist.github.com/stecman/ee1fd9a8b1b6f0fdd170ee87ba2ddafd.

## Transport

- Bluetooth Classic, SPP (UUID `00001101-0000-1000-8000-00805f9b34fb`) on **RFCOMM channel 1**.
- Channel 2 is "Wireless iAP" (Apple MFi accessory protocol). It sends `FF 55 …` frames; don't use it for raster data.
- The printer must be paired with the OS first.
- Plain byte stream both ways. No baud rate, no flow control, no write throttling needed: Brother's app writes a
  whole job (~2.4 KB) in one burst.
- One connection can stay open for many labels.
- Printer BT address of the test unit: `a0:66:10:95:64:a7`.

## Job sequence

Send one complete job per label, as one write:

```
00 x 100                      invalidate / flush
1B 69 61 01                   switch to raster mode (sent BEFORE initialize, like Brother's app)
1B 40                         initialize
1B 69 7A 84 mt w 00 c0 c1 c2 c3 00 00
                              print info:
                                84 = valid flags
                                mt = media type (copy status byte 11; 01 = laminated)
                                w  = tape width in mm (copy status byte 10; 0C = 12 mm)
                                00 = length (continuous tape)
                                c0..c3 = raster line count, uint32 little-endian
                                         MUST equal the number of 47 lines sent
1B 69 4B ch                   advanced mode: 08 = chain printing off, 00 = chain printing on
1B 69 4D vm                   various mode: 40 = feed out to the cutter after printing, 00 = don't
1B 69 64 m0 m1                margin in dots (uint16 LE) added at BOTH ends of the label
4D 02                         compression = TIFF PackBits
47 n0 n1 [data]               one raster line, n = byte length of the packed data (uint16 LE); repeat per line
1A                            print, last page (end every job with 1A, not 0C)
```

After "printing completed" (see below), send `1B 69 61 FF` (Brother's app does this after every label; purpose
unknown, harmless).

Before a job, send `1B 69 53` (status request) and use the reply's tape width and media type in the print info.
Brother's app sends it twice before each job.

### Raster lines

- The head has **128 dots**. One raster line = 16 bytes before compression.
- Dot `d` is bit `0x80 >> (d % 8)` of byte `d / 8` (dot 0 = MSB of byte 0). Set bit = black.
- One raster line = one column of a horizontal label. Lines go from the label's left end to its right end;
  the label's top edge is the lowest dot number. 180 dpi along the tape too (one line = 0.141 mm).
- Printable area on **12 mm tape: dots 32..95** (64 dots, 32 blank each side); **6 mm tape: dots 48..79** (32 dots,
  48 blank each side). Other widths are not verified.
- Every line is PackBits-compressed (each line separately, decompresses to 16 bytes):
  - run of 2..128 equal bytes: `(257 - run) & 0xFF`, then the byte
  - 1..128 literal bytes: `count - 1`, then the bytes
- Example from the capture: 150 lines, 2365-byte job.

## Status packets

32 bytes, header `80 20 42 30`. Bluetooth splits and merges packets, so buffer the incoming stream, find the
`80 20 42` header, and cut 32-byte packets from there. Never assume one read = one packet.

Offsets used by the app:

| Byte | Meaning |
|---|---|
| 4 | model id, `0x72` |
| 6 | battery: 0 full, 1 half, 2 low, 3 change, 4 AC |
| 8, 9 | error info 1 and 2 (bit flags, below) |
| 10 | tape width in mm (`0x0C` = 12 mm) |
| 11 | media type: 00 none, 01 laminated, 03 non-laminated, 11/17 heat-shrink, FF incompatible |
| 15 | echoes the various-mode byte (`1B 69 4D`) |
| 18 | status type: 00 reply, 01 printing completed, 02 error, 03 IF mode finished, 04 power off, 05 notification, 06 phase change |
| 19 | phase: 00 receiving (ready), 01 printing |
| 22 | notification |
| 24 | tape color (01 white, 08 black, … full table in `js/protocol.js`) |
| 25 | text color (01 white, 08 black, …) |

Error bits (Brother reference, used by the app): byte 8: 01 no tape, 02 tape end, 04 cutter jam, 08 weak batteries,
40 high-voltage adapter. Byte 9: 01 wrong tape, 10 cover open, 20 overheating.

Tape colors are what the cartridge reports, and knockoffs can lie: a black-on-yellow knockoff reports `01 08`
(white tape, black text). Genuine white-on-black 12 mm reports `08 01`. Knockoffs print fine with this protocol.

### What the printer sends after a job (no request needed)

1. ~0.15 s: type 06 phase change, phase 01 (printing)
2. ~3 s later: type 01 **printing completed**
3. right after: type 06 phase change, phase 00 (ready)

The app waits for "completed" (30 s timeout), then up to 2 s for the phase-00 change, then sends `1B 69 61 FF`.
Only then does it start the next job. A type 02 packet means error: stop and show bytes 8/9.
Register the waiters before sending: "completed" and "ready" can arrive in the same read.

Printing speed: ~20 mm/s; a 150-line label takes ~3.3 s end to end.

## Feed, cutter and chain printing (12 mm tape, measured)

The printer has a manual cutter about **25 mm** in front of the head.

- **Chain off, no feed-out (`4B 08`, `4D 00`):** the label stays inside after printing; the next job first feeds
  ~25 mm before printing. Wastes ~25 mm per label.
- **Feed-out (`4D 40`):** after printing, the label is fed out to the cutter. The printer also draws its own small
  cut mark (two short dots) in the front margin, if the margin is not 0.
- **Chain on (`4B 00`, `4D 00`):** the label stays inside and the next label prints right behind it.
- **Margin** (`1B 69 64`, dots) is added at both ends of the label. Default in Brother's app: 28 (`1C 00`, ~4 mm).
  Margin 0 is accepted.
- Gap between chained labels: **2.5 mm (18 dots) at margin 0**; ~4-5 mm at margin 28. This is the printer's own feed.
- Where the cutter lands on a fed-out label: about one margin past the last raster line. At **margin 0 it cuts
  on the last raster line** (verified: cuts through a 2-dot mark drawn at the end of the image). ~2 mm past at
  margin 14, ~5 mm at margin 28.
- The first label of a strip always has a ~25 mm leader (head-to-cutter distance).

### Recipe used by the app

- Single label, no cut marks: `4B 08`, `4D 40`, margin 28.
- Single label with drawn cut marks: `4B 08`, `4D 40`, margin 0; draw a mark at both ends of the image.
- Chained run (copies, or chain switch on): every label but the last `4B 00`, `4D 00`, margin 0; the last one
  `4B 08`, `4D 40`, margin 0. Each chained label draws only its leading mark plus its drawn gap; the printer's
  2.5 mm gap and the next label's leading mark close it. The last label draws both marks, and the cutter lands on
  its trailing mark.
- "Feed out" after a chained label: a job containing only a cut mark, `4B 08`, `4D 40`, margin 0.
- Drawn cut mark: 2 dots along the tape, dashed across it (4 dots on, 3 off).

## Platform notes

- **Web Serial (Chrome):** works on Android and macOS. `requestPort({ allowedBluetoothServiceClassIds: [SPP],
  filters: [{ bluetoothServiceClassId: SPP }] })`, then `open({ baudRate: 9600 })` (baud ignored). Needs HTTPS or
  localhost. On Android, `connect`/`disconnect` events and `port.connected` are unreliable: detect a dead link with
  status-request timeouts.
- **Chrome on macOS** sometimes fails to open the port ("SDP query timeout" in `chrome://device-log`):
  https://issues.chromium.org/issues/569041183. Intermittent (worked 2026-11-05, back 2026-11-07).
- **macOS native:** IOBluetooth RFCOMM channel 1 (Python + PyObjC, see `tools/ptest.py`) works reliably.
  Opening fails with `0xe00002bc` while Chrome holds the printer, or for ~2 s after the previous connection closes
  (retry). The `/dev/cu.PT-P300BT*` device macOS creates gave no replies; don't use it.
- **iPad / iOS:** no Web Serial in any iOS browser, and iOS has no general Bluetooth Classic SPP API. A native app
  would have to use the External Accessory framework over the printer's MFi "Wireless iAP" service (see Not verified).

## Not verified

- Print areas for 9 and 3.5 mm tape (from Brother's PT-P710BT reference, in `PRINT_AREA` in `js/protocol.js`):
  9 mm dots 39..88, 3.5 mm dots 52..75.
- Error bits and battery values have not been seen on a real error.
- `5A` (blank raster line shortcut) is not used and not tested.
- iOS: the External Accessory protocol string the printer advertises (Brother's SDK is believed to use
  `com.brother.ptcbp`), and whether the raster commands above work unchanged over that channel. Check with
  `EAAccessoryManager.connectedAccessories` (`protocolStrings`) on an iPad paired to the printer.
