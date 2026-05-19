# Firmware 100% Compatibility + UART & App Logging

## Summary

Fix all gaps between the Electron app and `firmware_arduino.ino`, add raw-byte UART logging with an in-app side panel and disk persistence, and add structured app-level logging to rotating daily log files.

---

## Section 1: SerialService (electron main process)

**File:** `electron/serial-service.ts` (new)

A single class replacing the loose serial logic in `main.ts`. Owns all serial state.

### Responsibilities

| Area | Detail |
|------|--------|
| Connection lifecycle | `connect(path, baud)`, `disconnect()`. On first data line, detect "Stepper Controller Ready" boot banner. |
| Command/response | Serialize commands with a promise per command, resolve on response line. **Critically**, also forward the response to the renderer and logger even when a pending command consumed it — this fixes the swallowed-position bug. |
| Position tracking | Parse `POS <num>` from movement responses and `Position: <num>` from STATUS output. Emit `serial:position` to renderer on every update. |
| Motor param sync | On every successful connection AND on boot-banner detection (Arduino reset), send SPEED/ACCEL/PULSE/HOLD then STATUS, syncing app defaults into firmware. |
| UART logging | Capture every byte written and every line read with µs timestamps into a configurable ring buffer (default 10,000 entries, configurable via constructor). |
| Error recovery | Emit `serial:connection-state` events (connected / disconnected / booting). Renderer can react to reconnections. |

### IPC channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `serial:connect` | renderer → main | Connect to path at baud |
| `serial:disconnect` | renderer → main | Disconnect |
| `serial:send` | renderer → main | Send command, returns response |
| `serial:is-connected` | renderer → main | Query connection state |
| `serial:list-ports` | renderer → main | Enumerate COM ports |
| `serial:data` | main → renderer | Raw line (backward compat) |
| `serial:position` | main → renderer | `{ position: number }` |
| `serial:connection-state` | main → renderer | `{ state: 'connected' \| 'disconnected' \| 'booting' }` |
| `serial:log-entry` | main → renderer | `{ ts: number, dir: 'TX' \| 'RX', hex: string, raw: string }` |
| `serial:log-query` | renderer → main | Request slice of ring buffer, returns array of log entries |
| `serial:log-clear` | renderer → main | Clear ring buffer |

### Byte-level logging detail

- **TX:** captured at `port.write()`. Each write is one log entry. Hex representation of every byte written, plus the raw string.
- **RX:** captured at `parser.on('data')`. Each line received is one log entry. Hex representation of every byte received (including the `\n` delimiter), plus the raw string.
- **Timestamp:** `performance.now()` µs precision, converted to epoch ms for storage.

---

## Section 2: UART Log Side Panel (renderer)

**File:** `src/components/UartLog.ts` (new)

A toggleable panel docked to the right edge of the window.

### Layout

- **Width:** 380px default, resizable via a 3px drag handle on the left edge
- **Header:** "UART Log" title + connection dot (green/gray) + "Clear" button + "X" close button
- **Toolbar:** direction filter (TX / RX / All) + search input + pause toggle
- **Log rows:** Each entry shows:
  - `HH:MM:SS.mmm` timestamp
  - Direction arrow (`→` green / `←` blue)
  - Hex bytes in monospace (e.g., `4C 45 46 54 20 35 30 30 0A`)
  - ASCII preview in dimmed text (e.g., `LEFT 500.`)
- **Auto-scroll:** follows new entries when scrolled to bottom; "↓ New" button when scrolled up
- **Virtualization:** Only render visible rows (~200 DOM nodes). Older entries above viewport are not rendered.

### Behavior

- Toggled by a button in the existing toolbar
- When open, camera view shrinks horizontally via flex layout
- Open/closed state persisted in settings
- Subscribes to `serial:log-entry` for real-time appends
- On open, calls `queryLog(0, 500)` to backfill

### Integration

- `App.ts` creates a `UartLog` instance, appends to `#app` container
- `App.toolbar` gets a new toggle button wired to `uartLog.toggle()`

---

## Section 3: App Logger + Disk Persistence

**File:** `electron/logger.ts` (new)

General-purpose logger for the main process. UART traffic is also written to the same log files.

### Log file spec

| Property | Value |
|----------|-------|
| Directory | `%APPDATA%/OpenScope/logs/` |
| Filename | `openscope-YYYY-MM-DD.log` |
| Rotation | New file daily at midnight |
| Retention | Keep last 7 days, delete older |
| Levels | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| Format | `[HH:MM:SS.mmm] [LEVEL] [source] message` |

### UART log entries on disk

Interleaved with app logs in same file:

```
[14:32:01.203] [INFO] [serial] Connected to COM3 at 115200 baud
[14:32:01.405] [UART] RX 53 74 65 70 70 65 72 20 43 6F 6E 74 72 6F 6C 6C 65 72 20 52 65 61 64 79 0A | Stepper Controller Ready.
[14:32:01.510] [INFO] [serial] Boot banner detected, syncing motor params
[14:32:01.520] [UART] TX 53 50 45 45 44 20 33 30 30 30 0A | SPEED 3000.
```

### Logged events

| Source | Events |
|--------|--------|
| `serial` | connect, disconnect, errors, boot banner, re-sync, baud |
| `autofocus` | sweep start/end, step count, best focus position/score, errors |
| `camera` | device selected, capture start/end, capture errors |
| `window` | app start, minimize, maximize, close |
| `ipc` | unhandled errors |

### IPC

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `log:get-path` | renderer → main | Returns log directory path |

Renderer can offer "Open logs folder" via `shell.openPath()` in settings or toolbar.

---

## Section 4: Changes to existing files

| File | Changes |
|------|---------|
| `electron/main.ts` | Strip serial logic. Instantiate `SerialService` and `Logger`. Wire IPC handlers to service methods. |
| `electron/preload.ts` | Add new API methods: `onLogEntry`, `queryLog`, `clearLog`, `onPosition`, `onConnectionState`, `getLogPath`. Backward-compatible. |
| `src/ipc.d.ts` | Add new type members to `SerialApi` and add `LogApi`. |
| `src/App.ts` | Add `UartLog` instance. Wire toolbar toggle. Replace `onData` position parsing with `onPosition` callback. Use `onConnectionState` for connected/disconnected UI. |
| `src/components/Toolbar.ts` | Add "UART Log" toggle button. |
| `src/components/UartLog.ts` | **New.** Full panel component. |
| `electron/serial-service.ts` | **New.** All serial state and logic. |
| `electron/logger.ts` | **New.** App logger with file rotation. |

---

## Section 5: Testing plan

| What | How |
|------|-----|
| SerialService unit | Mock `SerialPort`. Test connect/disconnect, command/response, boot banner detection, position parsing, motor sync dispatch. |
| Logger unit | Write entries, verify file rotation, retention, and format. |
| UART Log manual | Connect to Arduino, exercise jog/autofocus/zero, verify TX/RX show correct bytes, pause/search/filter work. |
| Position tracking manual | Jog left/right, verify HUD position updates per movement response (not just STATUS). |
| Reconnection manual | Unplug/replug Arduino USB, verify boot banner triggers re-sync and HUD shows reconnected state. |
| Full sweep manual | Run autofocus, verify all commands/responses logged, no swallowed POS lines, best-focus position correct. |

---

## Section 6: Log file example

```
[09:15:00.001] [INFO] [window] Application started
[09:15:02.340] [INFO] [serial] Connected to COM3 at 115200 baud
[09:15:02.541] [UART] RX 53 74 65 70 70 65 72 20 43 6F 6E 74 72 6F 6C 6C 65 72 20 52 65 61 64 79 0A | Stepper Controller Ready.
[09:15:02.545] [INFO] [serial] Boot banner detected, syncing motor params
[09:15:02.546] [UART] TX 53 50 45 45 44 20 33 30 30 30 0A | SPEED 3000.
[09:15:02.553] [UART] RX 4F 4B 0A | OK.
[09:15:02.554] [UART] TX 41 43 43 45 4C 20 38 30 30 30 0A | ACCEL 8000.
[09:15:02.560] [UART] RX 4F 4B 0A | OK.
[09:15:02.561] [UART] TX 50 55 4C 53 45 20 33 0A | PULSE 3.
[09:15:02.567] [UART] RX 4F 4B 0A | OK.
[09:15:02.568] [UART] TX 48 4F 4C 44 20 30 0A | HOLD 0.
[09:15:02.574] [UART] RX 4F 4B 0A | OK.
[09:15:02.575] [UART] TX 53 54 41 54 55 53 0A | STATUS.
[09:15:02.580] [UART] RX 2D 2D 2D 2D 2D 2D 20 53 54 41 54 55 53 20 2D 2D 2D 2D 2D 2D 0A | ------ STATUS ------.
[09:15:02.581] [UART] RX 50 6F 73 69 74 69 6F 6E 3A 20 30 0A | Position: 0.
[09:15:02.582] [UART] RX 53 70 65 65 64 3A 20 33 30 30 30 2E 30 30 0A | Speed: 3000.00.
[09:15:02.583] [UART] RX 41 63 63 65 6C 65 72 61 74 69 6F 6E 3A 20 38 30 30 30 2E 30 30 0A | Acceleration: 8000.00.
[09:15:02.584] [UART] RX 50 75 6C 73 65 20 57 69 64 74 68 3A 20 33 0A | Pulse Width: 3.
[09:15:02.585] [UART] RX 48 6F 6C 64 20 54 69 6D 65 3A 20 30 0A | Hold Time: 0.
[09:15:02.586] [UART] RX 4D 6F 74 6F 72 20 45 6E 61 62 6C 65 64 3A 20 4E 4F 0A | Motor Enabled: NO.
[09:15:02.587] [UART] RX 2D 2D 2D 2D 2D 2D 2D 2D 2D 2D 2D 2D 2D 2D 2D 2D 2D 2D 2D 2D 0A | --------------------.
[09:15:05.100] [INFO] [autofocus] Sweep started: range=1000, stepInterval=50, totalCaptures=20
[09:15:05.101] [UART] TX 4C 45 46 54 20 35 30 30 0A | LEFT 500.
[09:15:05.230] [UART] RX 50 4F 53 20 2D 35 30 30 0A | POS -500.
[09:15:05.235] [DEBUG] [autofocus] Sweep start position: -500
[09:15:05.300] [UART] TX 52 49 47 48 54 20 35 30 0A | RIGHT 50.
[09:15:05.400] [UART] RX 50 4F 53 20 2D 34 35 30 0A | POS -450.
[09:15:05.501] [DEBUG] [autofocus] Frame 1: step=450, score=0.87
...
[09:15:08.200] [INFO] [autofocus] Sweep complete: bestPosition=180, bestScore=0.94
```
