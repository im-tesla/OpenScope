# Firmware 100% Compatibility + UART & App Logging Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all firmware compatibility gaps (swallowed position updates, default mismatch, reconnection), add raw-byte UART logging with in-app side panel and disk persistence, and add structured app-level logging to rotating daily log files.

**Architecture:** New `SerialService` class in main process owns all serial state, command/response, position tracking, and UART logging in one place — fixing the swallowed-position bug at the root. New `Logger` class writes structured + UART logs to `%APPDATA%/OpenScope/logs/` with daily rotation. New `UartLog` renderer component provides a toggleable side panel showing raw hex + ASCII with filtering. Renderer consumes structured events (`serial:position`, `serial:connection-state`, `serial:log-entry`) while backward-compatible `serial:data` continues to fire.

**Tech Stack:** Electron 30, TypeScript, SerialPort 12, vanilla DOM (no framework)

---

### Task 1: Logger class (disk persistence)

**Files:**
- Create: `electron/logger.ts`

- [ ] **Step 1: Write Logger class**

```typescript
import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export class Logger {
  private logDir: string;
  private currentDate = '';
  private stream: fs.WriteStream | null = null;

  constructor(logDir: string) {
    this.logDir = logDir;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  debug(source: string, message: string): void { this.write('DEBUG', source, message); }
  info(source: string, message: string): void  { this.write('INFO', source, message); }
  warn(source: string, message: string): void  { this.write('WARN', source, message); }
  error(source: string, message: string): void { this.write('ERROR', source, message); }

  uart(dir: 'TX' | 'RX', hex: string, raw: string): void {
    this.write('UART', dir, `${hex} | ${raw}`);
  }

  getLogPath(): string {
    return this.logDir;
  }

  private write(level: LogLevel | 'UART', source: string, message: string): void {
    const now = new Date();
    this.rotateIfNeeded(now);
    const ts = this.fmtTime(now);
    const line = `[${ts}] [${level}] [${source}] ${message}\n`;
    this.stream?.write(line);
  }

  private rotateIfNeeded(now: Date): void {
    const today = this.fmtDate(now);
    if (today !== this.currentDate) {
      if (this.stream) {
        this.stream.end();
        this.stream = null;
      }
      this.currentDate = today;
      this.stream = fs.createWriteStream(this.logPath(today), { flags: 'a' });
      this.cleanupOldLogs(now);
    }
  }

  private logPath(date: string): string {
    return path.join(this.logDir, `openscope-${date}.log`);
  }

  private fmtDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private fmtTime(d: Date): string {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  }

  private cleanupOldLogs(now: Date): void {
    let files: string[];
    try {
      files = fs.readdirSync(this.logDir);
    } catch {
      return;
    }
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 7);
    for (const file of files) {
      const match = file.match(/^openscope-(\d{4}-\d{2}-\d{2})\.log$/);
      if (match) {
        const fileDate = new Date(match[1]);
        if (fileDate < cutoff) {
          try { fs.unlinkSync(path.join(this.logDir, file)); } catch { /* best effort */ }
        }
      }
    }
  }

  dispose(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit electron/logger.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add electron/logger.ts
git commit -m "feat: add Logger class with daily rotation and 7-day retention"
```

---

### Task 2: SerialService class (unifies serial state, fixes swallowed position bug)

**Files:**
- Create: `electron/serial-service.ts`
- Modify: `electron/logger.ts` (none — just imports)

- [ ] **Step 1: Write SerialService class**

```typescript
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { Logger } from './logger';

export interface MotorParams {
  speed: number;
  acceleration: number;
  pulseWidth: number;
  holdTime: number;
}

export interface LogEntry {
  ts: number;
  dir: 'TX' | 'RX';
  hex: string;
  raw: string;
}

export type ConnectionState = 'connected' | 'disconnected' | 'booting';

export type LogCallback = (entry: LogEntry) => void;
export type DataCallback = (data: string) => void;
export type PositionCallback = (pos: number) => void;
export type ConnectionStateCallback = (state: ConnectionState) => void;

const DEFAULT_MOTOR: MotorParams = {
  speed: 3000,
  acceleration: 8000,
  pulseWidth: 3,
  holdTime: 0,
};

function toHex(str: string): string {
  const bytes: string[] = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i).toString(16).toUpperCase().padStart(2, '0'));
  }
  return bytes.join(' ');
}

function asciiPreview(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    out += (c >= 32 && c <= 126) ? raw[i] : '.';
  }
  return out;
}

type PendingCommand = {
  resolve: (data: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class SerialService {
  private port: SerialPort | null = null;
  private serialReady = false;
  private pending: PendingCommand | null = null;
  private ringBuffer: LogEntry[] = [];
  private maxLogEntries: number;
  private logger: Logger;
  private currentPosition = 0;
  private motorParams: MotorParams = { ...DEFAULT_MOTOR };

  private onLogEntry: LogCallback | null = null;
  private onData: DataCallback | null = null;
  private onPosition: PositionCallback | null = null;
  private onConnectionState: ConnectionStateCallback | null = null;

  constructor(logger: Logger, maxLogEntries = 10000) {
    this.logger = logger;
    this.maxLogEntries = maxLogEntries;
  }

  // ---- Callback setters (called by IPC bridge) ----

  setOnLogEntry(cb: LogCallback): void { this.onLogEntry = cb; }
  setOnData(cb: DataCallback): void { this.onData = cb; }
  setOnPosition(cb: PositionCallback): void { this.onPosition = cb; }
  setOnConnectionState(cb: ConnectionStateCallback): void { this.onConnectionState = cb; }

  // ---- Public API ----

  async listPorts() {
    const ports = await SerialPort.list();
    return ports.map(p => ({ path: p.path, manufacturer: p.manufacturer, pnpId: p.pnpId }));
  }

  async connect(path: string, baudRate: number): Promise<void> {
    this.disconnect();

    this.emitConnectionState('booting');
    this.logger.info('serial', `Connecting to ${path} at ${baudRate} baud`);

    this.port = new SerialPort({ path, baudRate });
    const parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));

    parser.on('data', (line: string) => {
      const raw = line.trim();
      if (!raw) return;

      // Log RX bytes
      this.addLogEntry('RX', toHex(line), raw);

      // Always forward to renderer (fixes swallowed position bug)
      this.onData?.(raw);

      // Parse position from this line
      this.trackPosition(raw);

      // Boot banner detection for Arduino reset while port stays open
      if (raw === 'Stepper Controller Ready') {
        this.logger.info('serial', 'Boot banner detected (Arduino reset), re-syncing motor params');
        this.syncMotorParams();
        return;
      }

      // Resolve pending command if one is waiting
      if (this.pending && this.serialReady) {
        clearTimeout(this.pending.timer);
        this.pending.resolve(raw);
        this.pending = null;
      }
    });

    this.port.on('close', () => {
      this.port = null;
      this.serialReady = false;
      this.emitConnectionState('disconnected');
      this.logger.info('serial', 'Port closed');
    });

    this.port.on('error', (err) => {
      this.logger.error('serial', err.message);
    });

    return new Promise<void>((resolve) => {
      let resolved = false;
      const bootTimer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.serialReady = true;
        this.emitConnectionState('connected');
        this.logger.info('serial', `Connected to ${path}`);
        this.syncMotorParams();
        resolve();
      }, 2000);

      parser.once('data', (line: string) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(bootTimer);
        this.serialReady = true;
        this.emitConnectionState('connected');
        this.logger.info('serial', `Connected to ${path}`);
        // The regular 'on' handler processes the data (log, forward, position, boot banner)
        // If first line is a boot banner, syncMotorParams is called by the 'on' handler
        // Otherwise, call it here
        const raw = line.trim();
        if (raw !== 'Stepper Controller Ready') {
          this.syncMotorParams();
        }
        resolve();
      });
    });
  }

  disconnect(): void {
    this.serialReady = false;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Disconnected'));
      this.pending = null;
    }
    if (this.port?.isOpen) {
      this.port.close();
    }
    this.port = null;
  }

  private writeRaw(data: string): void {
    this.addLogEntry('TX', toHex(data), data.trim());
    this.port?.write(data);
  }

  async send(command: string): Promise<string> {
    if (!this.port?.isOpen) throw new Error('Not connected');
    if (!this.serialReady) throw new Error('Serial not ready');

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('Command timeout'));
      }, 5000);

      this.pending = { resolve, reject, timer };
      this.writeRaw(command + '\n');
    });
  }

  isConnected(): boolean {
    return this.port?.isOpen ?? false;
  }

  setMotorParams(params: MotorParams): void {
    this.motorParams = { ...params };
    if (this.isConnected() && this.serialReady) {
      this.syncMotorParams();
    }
  }

  queryLog(offset: number, count: number): LogEntry[] {
    const start = Math.max(0, offset);
    const end = Math.min(this.ringBuffer.length, start + count);
    return this.ringBuffer.slice(start, end);
  }

  clearLog(): void {
    this.ringBuffer = [];
  }

  // ---- Private ----

  private emitConnectionState(state: ConnectionState): void {
    this.onConnectionState?.(state);
  }

  private addLogEntry(dir: 'TX' | 'RX', hex: string, raw: string): void {
    const entry: LogEntry = { ts: Date.now(), dir, hex, raw };
    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > this.maxLogEntries) {
      this.ringBuffer.shift();
    }
    this.onLogEntry?.(entry);
    this.logger.uart(dir, hex, raw);
  }

  private trackPosition(line: string): void {
    const posMatch = line.match(/^POS\s+(-?\d+)/);
    if (posMatch) {
      this.currentPosition = parseInt(posMatch[1], 10);
      this.onPosition?.(this.currentPosition);
      return;
    }
    const statusMatch = line.match(/^Position:\s*(-?\d+)/);
    if (statusMatch) {
      this.currentPosition = parseInt(statusMatch[1], 10);
      this.onPosition?.(this.currentPosition);
    }
  }

  private syncMotorParams(): void {
    const m = this.motorParams;
    this.writeRaw(`SPEED ${m.speed}\n`);
    this.writeRaw(`ACCEL ${m.acceleration}\n`);
    this.writeRaw(`PULSE ${m.pulseWidth}\n`);
    this.writeRaw(`HOLD ${m.holdTime}\n`);
    this.writeRaw(`STATUS\n`);
    this.logger.info('serial', `Motor params synced: speed=${m.speed}, accel=${m.acceleration}, pulse=${m.pulseWidth}, hold=${m.holdTime}`);
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit electron/serial-service.ts`
Expected: No errors (may warn about serialport types if not installed — that's expected).

- [ ] **Step 3: Commit**

```bash
git add electron/serial-service.ts
git commit -m "feat: add SerialService with position tracking, motor sync, and UART logging"
```

---

### Task 3: Wire main.ts to use SerialService and Logger

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Rewrite main.ts with SerialService + Logger integration**

Replace the entire file content:

```typescript
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import * as path from 'path';
import { SerialService, type MotorParams, type ConnectionState } from './serial-service';
import { Logger } from './logger';
import { SettingsStore } from './settings';

let mainWindow: BrowserWindow | null = null;
let serialService: SerialService;
let logger: Logger;
let settings: SettingsStore;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  Menu.setApplicationMenu(null);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    serialService.disconnect();
  });

  // Window control IPC
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);
}

function setupSerialIPC() {
  // Callback → renderer helpers
  const send = (channel: string, data: unknown) => {
    mainWindow?.webContents.send(channel, data);
  };

  serialService.setOnLogEntry((entry) => send('serial:log-entry', entry));
  serialService.setOnData((data) => send('serial:data', data));
  serialService.setOnPosition((pos) => send('serial:position', { position: pos }));
  serialService.setOnConnectionState((state: ConnectionState) =>
    send('serial:connection-state', { state })
  );

  // Invoke handlers
  ipcMain.handle('serial:list', async () => serialService.listPorts());

  ipcMain.handle('serial:connect', async (_e, path: string, baudRate: number) => {
    await serialService.connect(path, baudRate);
  });

  ipcMain.handle('serial:disconnect', async () => {
    serialService.disconnect();
  });

  ipcMain.handle('serial:send', async (_e, command: string) => {
    return serialService.send(command);
  });

  ipcMain.handle('serial:is-connected', async () => {
    return serialService.isConnected();
  });

  ipcMain.handle('serial:set-motor-params', async (_e, params: MotorParams) => {
    serialService.setMotorParams(params);
  });

  ipcMain.handle('serial:log-query', async (_e, offset: number, count: number) => {
    return serialService.queryLog(offset, count);
  });

  ipcMain.handle('serial:log-clear', async () => {
    serialService.clearLog();
  });
}

function setupLogIPC() {
  ipcMain.handle('log:get-path', async () => {
    return logger.getLogPath();
  });

  ipcMain.handle('log:open-folder', async () => {
    shell.openPath(logger.getLogPath());
  });
}

// ---- App lifecycle ----

app.whenReady().then(() => {
  settings = new SettingsStore();
  const logDir = path.join(app.getPath('userData'), 'logs');
  logger = new Logger(logDir);
  logger.info('window', 'Application started');
  serialService = new SerialService(logger);

  createWindow();
  setupSerialIPC();
  setupLogIPC();
});

app.on('window-all-closed', () => {
  serialService.disconnect();
  logger.dispose();
  app.quit();
});

app.on('before-quit', () => {
  serialService.disconnect();
  logger.dispose();
});
```

- [ ] **Step 2: Verify full TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors across the project.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "refactor: wire main.ts to SerialService and Logger"
```

---

### Task 4: Update preload.ts and ipc.d.ts with new API surface

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/ipc.d.ts`

- [ ] **Step 1: Rewrite preload.ts with new methods**

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import type { MotorParams } from './serial-service';

contextBridge.exposeInMainWorld('openscope', {
  serial: {
    listPorts: () => ipcRenderer.invoke('serial:list'),
    connect: (path: string, baudRate: number) =>
      ipcRenderer.invoke('serial:connect', path, baudRate),
    disconnect: () => ipcRenderer.invoke('serial:disconnect'),
    send: (command: string) => ipcRenderer.invoke('serial:send'),
    isConnected: () => ipcRenderer.invoke('serial:is-connected'),
    setMotorParams: (params: MotorParams) =>
      ipcRenderer.invoke('serial:set-motor-params', params),
    queryLog: (offset: number, count: number) =>
      ipcRenderer.invoke('serial:log-query', offset, count),
    clearLog: () => ipcRenderer.invoke('serial:log-clear'),
    onData: (cb: (data: string) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: string) => cb(d);
      ipcRenderer.on('serial:data', h);
      return () => ipcRenderer.removeListener('serial:data', h);
    },
    onDisconnected: (cb: (error?: string) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d?: string) => cb(d);
      ipcRenderer.on('serial:disconnected', h);
      return () => ipcRenderer.removeListener('serial:disconnected', h);
    },
    onError: (cb: (msg: string) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: string) => cb(d);
      ipcRenderer.on('serial:error', h);
      return () => ipcRenderer.removeListener('serial:error', h);
    },
    onLogEntry: (cb: (entry: { ts: number; dir: string; hex: string; raw: string }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { ts: number; dir: string; hex: string; raw: string }) => cb(d);
      ipcRenderer.on('serial:log-entry', h);
      return () => ipcRenderer.removeListener('serial:log-entry', h);
    },
    onPosition: (cb: (payload: { position: number }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { position: number }) => cb(d);
      ipcRenderer.on('serial:position', h);
      return () => ipcRenderer.removeListener('serial:position', h);
    },
    onConnectionState: (cb: (payload: { state: string }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { state: string }) => cb(d);
      ipcRenderer.on('serial:connection-state', h);
      return () => ipcRenderer.removeListener('serial:connection-state', h);
    },
  },
  settings: {
    get: <T>(key: string, fallback: T): Promise<T> =>
      ipcRenderer.invoke('settings:get', key, fallback),
    set: (key: string, value: unknown) =>
      ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll') as Promise<Record<string, unknown>>,
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  },
  log: {
    getPath: () => ipcRenderer.invoke('log:get-path'),
    openFolder: () => ipcRenderer.invoke('log:open-folder'),
  },
});
```

- [ ] **Step 2: Update ipc.d.ts with new type definitions**

```typescript
export interface PortInfo {
  path: string;
  manufacturer?: string;
  pnpId?: string;
}

export interface LogEntry {
  ts: number;
  dir: 'TX' | 'RX';
  hex: string;
  raw: string;
}

export interface MotorParams {
  speed: number;
  acceleration: number;
  pulseWidth: number;
  holdTime: number;
}

export interface SerialApi {
  listPorts: () => Promise<PortInfo[]>;
  connect: (path: string, baudRate: number) => Promise<void>;
  disconnect: () => Promise<void>;
  send: (command: string) => Promise<string>;
  isConnected: () => Promise<boolean>;
  setMotorParams: (params: MotorParams) => Promise<void>;
  queryLog: (offset: number, count: number) => Promise<LogEntry[]>;
  clearLog: () => Promise<void>;
  onData: (cb: (data: string) => void) => () => void;
  onDisconnected: (cb: (error?: string) => void) => () => void;
  onError: (cb: (msg: string) => void) => () => void;
  onLogEntry: (cb: (entry: LogEntry) => void) => () => void;
  onPosition: (cb: (payload: { position: number }) => void) => () => void;
  onConnectionState: (cb: (payload: { state: string }) => void) => () => void;
}

export interface SettingsApi {
  get: <T>(key: string, fallback: T) => Promise<T>;
  set: (key: string, value: unknown) => Promise<void>;
  getAll: () => Promise<Record<string, unknown>>;
}

export interface LogApi {
  getPath: () => Promise<string>;
  openFolder: () => Promise<void>;
}

declare global {
  interface Window {
    openscope: {
      serial: SerialApi;
      settings: SettingsApi;
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
      };
      log: LogApi;
    };
  }
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add electron/preload.ts src/ipc.d.ts
git commit -m "feat: add new IPC methods for log, position, connection state, and motor params"
```

---

### Task 5: UartLog component (side panel)

**Files:**
- Create: `src/components/UartLog.ts`

- [ ] **Step 1: Write UartLog component**

```typescript
interface LogEntry {
  ts: number;
  dir: 'TX' | 'RX';
  hex: string;
  raw: string;
}

export class UartLog {
  el: HTMLDivElement;
  private panel: HTMLDivElement;
  private logContainer: HTMLDivElement;
  private resizeHandle: HTMLDivElement;
  private connectionDot: HTMLSpanElement;
  private filterSelect: HTMLSelectElement;
  private searchInput: HTMLInputElement;
  private pauseBtn: HTMLButtonElement;

  private entries: LogEntry[] = [];
  private paused = false;
  private filter: 'TX' | 'RX' | 'ALL' = 'ALL';
  private searchTerm = '';
  private visible = false;
  private width = 380;
  private autoScroll = true;
  private renderCap = 500;
  private disposeFns: (() => void)[] = [];

  onClose: (() => void) | null = null;

  constructor() {
    // Outer wrapper (hidden by default)
    this.el = document.createElement('div');
    this.el.style.cssText = `
      display: none;
      position: absolute; right: 58px; top: 38px; bottom: 0;
      background: #09090b;
      border-left: 1px solid #1f1f23;
      z-index: 20;
      flex-direction: column;
    `;

    // Resize handle (left edge)
    this.resizeHandle = document.createElement('div');
    this.resizeHandle.style.cssText = `
      position: absolute; left: 0; top: 0; bottom: 0;
      width: 3px; cursor: ew-resize; z-index: 21;
      transition: background 150ms;
    `;
    this.resizeHandle.onmouseenter = () => { this.resizeHandle.style.background = '#8b5cf6'; };
    this.resizeHandle.onmouseleave = () => {
      if (!(this.resizeHandle as any).__dragging) this.resizeHandle.style.background = 'transparent';
    };
    this.resizeHandle.onmousedown = (e) => {
      (this.resizeHandle as any).__dragging = true;
      this.resizeHandle.style.background = '#8b5cf6';
      const startX = e.clientX;
      const startW = this.width;
      const onMove = (ev: MouseEvent) => {
        this.width = Math.max(280, Math.min(700, startW + (startX - ev.clientX)));
        this.el.style.width = `${this.width}px`;
      };
      const onUp = () => {
        (this.resizeHandle as any).__dragging = false;
        this.resizeHandle.style.background = 'transparent';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    this.el.appendChild(this.resizeHandle);

    // Panel content
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      display: flex; flex-direction: column; height: 100%;
    `;

    // Header
    const header = this.buildHeader();
    this.panel.appendChild(header);

    // Toolbar
    const toolbar = this.buildToolbar();
    this.panel.appendChild(toolbar);

    // Log container
    this.logContainer = document.createElement('div');
    this.logContainer.style.cssText = `
      flex: 1; overflow-y: auto; overflow-x: hidden;
      padding: 4px 0;
      font-family: 'Cascadia Code', 'Consolas', 'JetBrains Mono', monospace;
      font-size: 11px;
      line-height: 1.55;
    `;
    this.logContainer.onscroll = () => {
      const el = this.logContainer;
      this.autoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    };
    this.panel.appendChild(this.logContainer);

    // "Scroll to bottom" button
    const scrollBtn = document.createElement('button');
    scrollBtn.textContent = '↓ New';
    scrollBtn.style.cssText = `
      display: none; position: absolute; bottom: 8px; right: 12px;
      background: #8b5cf6; color: #fff; border: none; border-radius: 12px;
      padding: 4px 12px; font-size: 11px; cursor: pointer; z-index: 22;
      font-family: 'Segoe UI', system-ui, sans-serif;
    `;
    scrollBtn.onclick = () => {
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
      this.autoScroll = true;
    };
    this.el.appendChild(scrollBtn);

    // Periodically check if we need to show the scroll button
    setInterval(() => {
      if (!this.autoScroll && this.visible) {
        scrollBtn.style.display = 'block';
      } else {
        scrollBtn.style.display = 'none';
      }
    }, 300);

    this.el.appendChild(this.panel);
    this.el.style.width = `${this.width}px`;

    // Connection dot reference
    this.connectionDot = header.querySelector('.uart-conn-dot') as HTMLSpanElement;
  }

  private buildHeader(): HTMLDivElement {
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex; align-items: center; gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid #1f1f23;
      flex-shrink: 0;
    `;

    const dot = document.createElement('span');
    dot.className = 'uart-conn-dot status-dot off';
    header.appendChild(dot);

    const title = document.createElement('span');
    title.textContent = 'UART Log';
    title.style.cssText = 'font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #a1a1aa; flex: 1;';
    header.appendChild(title);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = `
      background: none; border: 1px solid #27272a; color: #71717a; border-radius: 3px;
      padding: 2px 8px; font-size: 11px; cursor: pointer; font-family: inherit;
    `;
    clearBtn.onmouseenter = () => { clearBtn.style.color = '#e4e4e7'; clearBtn.style.background = '#27272a'; };
    clearBtn.onmouseleave = () => { clearBtn.style.color = '#71717a'; clearBtn.style.background = 'none'; };
    clearBtn.onclick = () => {
      this.entries = [];
      this.logContainer.innerHTML = '';
      window.openscope.serial.clearLog();
    };
    header.appendChild(clearBtn);

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&#10005;';
    closeBtn.style.cssText = `
      background: none; border: none; color: #52525b; font-size: 14px; cursor: pointer;
      padding: 2px 6px; border-radius: 3px;
    `;
    closeBtn.onmouseenter = () => { closeBtn.style.color = '#e4e4e7'; closeBtn.style.background = '#27272a'; };
    closeBtn.onmouseleave = () => { closeBtn.style.color = '#52525b'; closeBtn.style.background = 'none'; };
    closeBtn.onclick = () => this.hide();
    header.appendChild(closeBtn);

    return header;
  }

  private buildToolbar(): HTMLDivElement {
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      display: flex; align-items: center; gap: 6px;
      padding: 4px 12px;
      border-bottom: 1px solid #1f1f23;
      flex-shrink: 0;
    `;

    // Filter dropdown
    this.filterSelect = document.createElement('select');
    this.filterSelect.style.cssText = `
      background: #18181b; border: 1px solid #27272a; color: #a1a1aa;
      padding: 2px 6px; border-radius: 3px; font-size: 11px;
      font-family: inherit; cursor: pointer; outline: none;
    `;
    this.filterSelect.innerHTML = `
      <option value="ALL">All</option>
      <option value="TX">TX</option>
      <option value="RX">RX</option>
    `;
    this.filterSelect.onchange = () => {
      this.filter = this.filterSelect.value as 'TX' | 'RX' | 'ALL';
      this.rerender();
    };
    toolbar.appendChild(this.filterSelect);

    // Search input
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = 'Filter...';
    this.searchInput.style.cssText = `
      flex: 1; background: #18181b; border: 1px solid #27272a; color: #e4e4e7;
      padding: 2px 8px; border-radius: 3px; font-size: 11px;
      font-family: inherit; outline: none; min-width: 68px;
    `;
    this.searchInput.oninput = () => {
      this.searchTerm = this.searchInput.value.toLowerCase();
      this.rerender();
    };
    toolbar.appendChild(this.searchInput);

    // Pause button
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.textContent = '⏸';
    this.pauseBtn.title = 'Pause auto-scroll';
    this.pauseBtn.style.cssText = `
      background: none; border: 1px solid #27272a; color: #71717a; border-radius: 3px;
      padding: 2px 6px; font-size: 12px; cursor: pointer;
    `;
    this.pauseBtn.onclick = () => {
      this.paused = !this.paused;
      this.pauseBtn.textContent = this.paused ? '▶' : '⏸';
      this.pauseBtn.style.color = this.paused ? '#f59e0b' : '#71717a';
    };
    toolbar.appendChild(this.pauseBtn);

    return toolbar;
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.visible = true;
    this.el.style.display = 'flex';
    this.backfill();
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.visible;
  }

  addEntry(entry: LogEntry): void {
    if (this.paused) return;
    this.entries.push(entry);
    // Cap total stored entries
    if (this.entries.length > this.renderCap * 2) {
      this.entries = this.entries.slice(-this.renderCap);
    }
    if (!this.visible) return;
    if (!this.matchesFilter(entry)) return;
    this.appendEntryDom(entry);
  }

  setConnected(connected: boolean): void {
    this.connectionDot.className = `uart-conn-dot status-dot ${connected ? 'on' : 'off'}`;
  }

  private async backfill(): Promise<void> {
    try {
      const entries = await window.openscope.serial.queryLog(0, 500);
      this.entries = entries;
      this.rerender();
    } catch { /* ignore if not connected yet */ }
  }

  private rerender(): void {
    this.logContainer.innerHTML = '';
    const filtered = this.entries.filter(e => this.matchesFilter(e));
    const toRender = filtered.slice(-this.renderCap);
    const frag = document.createDocumentFragment();
    for (const entry of toRender) {
      frag.appendChild(this.buildEntryDom(entry));
    }
    this.logContainer.appendChild(frag);
    if (this.autoScroll) {
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
  }

  private appendEntryDom(entry: LogEntry): void {
    const node = this.buildEntryDom(entry);
    this.logContainer.appendChild(node);
    // Trim old DOM nodes
    while (this.logContainer.children.length > this.renderCap) {
      this.logContainer.firstChild?.remove();
    }
    if (this.autoScroll) {
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
  }

  private matchesFilter(entry: LogEntry): boolean {
    if (this.filter !== 'ALL' && entry.dir !== this.filter) return false;
    if (this.searchTerm) {
      const haystack = `${entry.hex} ${entry.raw}`.toLowerCase();
      if (!haystack.includes(this.searchTerm)) return false;
    }
    return true;
  }

  private buildEntryDom(entry: LogEntry): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; gap: 6px; padding: 1px 12px;
      align-items: flex-start; white-space: nowrap;
    `;
    row.onmouseenter = () => { row.style.background = '#18181b'; };
    row.onmouseleave = () => { row.style.background = 'transparent'; };

    // Timestamp
    const d = new Date(entry.ts);
    const ts = document.createElement('span');
    ts.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    ts.style.cssText = 'color: #52525b; flex-shrink: 0;';
    row.appendChild(ts);

    // Direction arrow
    const dir = document.createElement('span');
    dir.textContent = entry.dir === 'TX' ? '→' : '←';
    dir.style.cssText = `color: ${entry.dir === 'TX' ? '#4ade80' : '#60a5fa'}; flex-shrink: 0; font-weight: 600;`;
    row.appendChild(dir);

    // Hex bytes
    const hex = document.createElement('span');
    hex.textContent = entry.hex;
    hex.style.cssText = 'color: #a1a1aa;';
    row.appendChild(hex);

    // ASCII preview
    const ascii = document.createElement('span');
    ascii.textContent = `| ${this.asciiPreview(entry.raw)}`;
    ascii.style.cssText = 'color: #52525b;';
    row.appendChild(ascii);

    return row;
  }

  private asciiPreview(raw: string): string {
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      out += (c >= 32 && c <= 126) ? raw[i] : '.';
    }
    return out;
  }

  /** Subscribe to serial log entries from the main process */
  listen(): void {
    const unsub = window.openscope.serial.onLogEntry((entry) => {
      this.addEntry(entry);
    });
    this.disposeFns.push(unsub);
  }

  dispose(): void {
    for (const fn of this.disposeFns) {
      fn();
    }
    this.disposeFns = [];
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/UartLog.ts
git commit -m "feat: add UartLog side panel component with hex+ascii view and filtering"
```

---

### Task 6: Update Toolbar with UART log toggle button

**Files:**
- Modify: `src/components/Toolbar.ts`

- [ ] **Step 1: Add UART log toggle button to Toolbar**

Edit `src/components/Toolbar.ts` — add a `uartBtn` property and wire it up.

After the `onSettings` declaration (line 11), add:

```typescript
  onUartToggle: (() => void) | null = null;
```

After the `settingsBtn` block (lines 46-53), add the uart button:

```typescript
    this.uartBtn = this.makeIcon(
      `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4">
        <rect x="2" y="5" width="16" height="10" rx="2"/>
        <path d="M6 9l3 3 5-5"/>
      </svg>`,
      'UART Log'
    );
```

And add the click handler after the settings one:

```typescript
    this.uartBtn.onclick = () => this.onUartToggle?.();
```

Add the `uartBtn` property declaration next to the other button properties (after `private settingsBtn`):

```typescript
  private uartBtn: HTMLButtonElement;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Toolbar.ts
git commit -m "feat: add UART log toggle button to toolbar"
```

---

### Task 7: Update App.ts to integrate UartLog and use new serial events

**Files:**
- Modify: `src/App.ts`

- [ ] **Step 1: Rewrite App.ts with UartLog integration and structured events**

Replace the file content:

```typescript
import { CameraView } from './components/CameraView';
import { HudOverlay } from './components/HudOverlay';
import { Toolbar } from './components/Toolbar';
import { UartLog } from './components/UartLog';
import { SettingsModal, type SettingsData } from './components/SettingsModal';
import type { AppMode, FocusPoint, SweepParams, MotorParams } from './engine/state';
import { defaultSweep, defaultMotor } from './engine/state';

export class App {
  camera: CameraView;
  hud: HudOverlay;
  toolbar: Toolbar;
  uartLog: UartLog;
  settingsModal: SettingsModal;
  worker: Worker;

  private mode: AppMode = 'idle';
  private sweepData: FocusPoint[] = [];
  private sweepSettings = { ...defaultSweep };
  private motorSettings = { ...defaultMotor };
  private currentPosition: number | null = null;
  private workerResolve: ((score: number) => void) | null = null;

  constructor() {
    this.camera = new CameraView();
    this.hud = new HudOverlay();
    this.toolbar = new Toolbar();
    this.uartLog = new UartLog();
    this.settingsModal = new SettingsModal();
    this.worker = new Worker(new URL('./engine/worker.ts', import.meta.url), { type: 'module' });
  }

  async init() {
    const app = document.getElementById('app')!;

    this.buildTitleBar(app);
    this.buildResizeHandles(app);

    app.appendChild(this.camera.el);
    app.appendChild(this.hud.el);
    app.appendChild(this.toolbar.el);
    app.appendChild(this.uartLog.el);
    app.appendChild(this.settingsModal.el);

    this.bindEvents();
    await this.loadAndApplySettings();
    this.setupKeyboard();
    this.setupSerialListeners();
    this.uartLog.listen();

    // Persist uartLog visibility
    const uartOpen = await window.openscope.settings.get<boolean>('uartLogOpen', false);
    if (uartOpen) this.uartLog.show();
  }

  private buildTitleBar(container: HTMLElement) {
    const bar = document.createElement('div');
    bar.className = 'titlebar';

    const label = document.createElement('span');
    label.className = 'titlebar-label';
    label.textContent = 'OpenScope';

    const ctrls = document.createElement('div');
    ctrls.className = 'titlebar-ctrls';

    const minBtn = this.makeTitleBtn('&#9472;', 'min');
    minBtn.onclick = () => window.openscope.window.minimize();
    const maxBtn = this.makeTitleBtn('&#9723;', 'max');
    maxBtn.onclick = async () => {
      await window.openscope.window.maximize();
      maxBtn.innerHTML = (await window.openscope.window.isMaximized()) ? '&#9634;' : '&#9723;';
    };
    const closeBtn = this.makeTitleBtn('&#10005;', 'close');
    closeBtn.classList.add('close');
    closeBtn.onclick = () => window.openscope.window.close();

    ctrls.appendChild(minBtn);
    ctrls.appendChild(maxBtn);
    ctrls.appendChild(closeBtn);
    bar.appendChild(label);
    bar.appendChild(ctrls);
    container.appendChild(bar);

    bar.addEventListener('dblclick', () => window.openscope.window.maximize());
  }

  private makeTitleBtn(html: string, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.innerHTML = html;
    btn.className = 'titlebar-btn';
    btn.title = label;
    return btn;
  }

  private buildResizeHandles(container: HTMLElement) {
    const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    for (const e of edges) {
      const div = document.createElement('div');
      div.className = `resize-${e}`;
      container.appendChild(div);
    }
  }

  private bindEvents() {
    this.toolbar.onFocus = () => this.toggleAutofocus();
    this.toolbar.onStop = () => this.stop();
    this.toolbar.onZero = () => this.zeroPosition();
    this.toolbar.onSettings = () => this.openSettings();
    this.toolbar.onUartToggle = () => this.toggleUartLog();

    this.hud.onJog = (dir) => this.jog(dir);
    this.hud.onZero = () => this.zeroPosition();

    this.uartLog.onClose = () => {
      window.openscope.settings.set('uartLogOpen', false);
    };

    this.settingsModal.onSave = (data) => this.applySettings(data);

    this.settingsModal.onRefreshDevices = async () => {
      const cameras = await CameraView.list();
      const comPorts = await window.openscope.serial.listPorts();
      return {
        cameras: cameras.map(c => ({
          deviceId: c.deviceId,
          label: c.label || `Camera ${c.deviceId.slice(0, 8)}`,
        })),
        comPorts: comPorts.map(p => ({
          path: p.path,
          label: `${p.path}${p.manufacturer ? ' - ' + p.manufacturer : ''}`,
        })),
      };
    };

    this.worker.onmessage = (e: MessageEvent<{ score: number }>) => {
      const score = e.data.score;
      if (this.mode === 'sweeping') {
        this.sweepData.push({ position: this.currentPosition ?? this.sweepData.length, score });
        this.hud.addFocusPoint({ position: this.sweepData.length, score });
        this.hud.setFocusScore(score);
      }
      if (this.workerResolve) {
        this.workerResolve(score);
        this.workerResolve = null;
      }
    };
  }

  private setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (this.settingsModal.el.style.display === 'flex') return;
      switch (e.key) {
        case 'ArrowLeft':  e.preventDefault(); this.jog(-1); break;
        case 'ArrowRight': e.preventDefault(); this.jog(1); break;
        case ' ':          e.preventDefault(); this.toggleAutofocus(); break;
        case 'Escape':     e.preventDefault(); this.stop(); break;
        case 'z':          if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); this.zeroPosition(); } break;
        case 's':          if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); this.openSettings(); } break;
        case 'l':          if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); this.toggleUartLog(); } break;
      }
    });
  }

  private setupSerialListeners() {
    const api = window.openscope.serial;

    // Structured position updates from SerialService (fixes swallowed POS bug)
    api.onPosition((payload) => {
      this.currentPosition = payload.position;
      this.hud.setPosition(payload.position);
    });

    // Connection state tracking
    api.onConnectionState((payload) => {
      const connected = payload.state === 'connected';
      this.uartLog.setConnected(connected);

      if (payload.state === 'connected') {
        this.hud.setConnected(true);
        this.toolbar.setEnabled(true);
        this.hud.setJogEnabled(true);
      } else if (payload.state === 'disconnected') {
        this.hud.setConnected(false);
        this.toolbar.setEnabled(false);
        this.hud.setJogEnabled(false);
        if (this.mode === 'sweeping' || this.mode === 'focusing') {
          this.mode = 'error';
          this.toolbar.setFocusActive(false);
        }
        if (this.workerResolve) {
          this.workerResolve(0);
          this.workerResolve = null;
        }
      }
    });

    // Keep raw data listener for backward compat (unsolicited STATUS lines, etc.)
    api.onData((data: string) => {
      // Position is now tracked via onPosition, but keep fallback
      if (data.startsWith('POS ')) {
        const pos = parseInt(data.slice(4), 10);
        if (!isNaN(pos)) {
          this.currentPosition = pos;
          this.hud.setPosition(pos);
        }
      }
      const statusMatch = data.match(/^Position:\s*(-?\d+)/);
      if (statusMatch) {
        const pos = parseInt(statusMatch[1], 10);
        this.currentPosition = pos;
        this.hud.setPosition(pos);
      }
    });

    api.onError((msg: string) => {
      console.error('Serial error:', msg);
    });
  }

  private async loadAndApplySettings() {
    const s = window.openscope.settings;
    const camId = await s.get<string>('cameraDeviceId', '');
    const comPort = await s.get<string>('comPort', '');
    this.sweepSettings = await s.get<SweepParams>('sweep', defaultSweep);
    this.motorSettings = await s.get<MotorParams>('motor', defaultMotor);

    await this.camera.start(camId || undefined);

    // Sync motor params to SerialService before connecting
    await window.openscope.serial.setMotorParams(this.motorSettings);

    if (comPort) {
      try {
        await window.openscope.serial.connect(comPort, 115200);
        // Connection state and motor sync are now handled by SerialService internally
      } catch {
        this.hud.setConnected(false);
      }
    }
  }

  private async applySettings(data: SettingsData) {
    const s = window.openscope.settings;
    await s.set('cameraDeviceId', data.cameraDeviceId);
    await s.set('comPort', data.comPort);
    await s.set('sweep', data.sweep);
    await s.set('motor', data.motor);

    this.sweepSettings = data.sweep;
    this.motorSettings = data.motor;

    // Update SerialService with new motor params
    await window.openscope.serial.setMotorParams(data.motor);

    const prevCam = await s.get<string>('_lastCam', '');
    if (data.cameraDeviceId !== prevCam) {
      await s.set('_lastCam', data.cameraDeviceId);
      await this.camera.start(data.cameraDeviceId || undefined);
    }

    const wasConnected = await window.openscope.serial.isConnected();
    if (!wasConnected && data.comPort) {
      try {
        await window.openscope.serial.connect(data.comPort, 115200);
      } catch {
        this.hud.setConnected(false);
      }
    }
  }

  private toggleUartLog() {
    this.uartLog.toggle();
    window.openscope.settings.set('uartLogOpen', this.uartLog.isVisible());
  }

  private async openSettings() {
    const s = window.openscope.settings;
    const cameraDeviceId = await s.get<string>('cameraDeviceId', '');
    const comPort = await s.get<string>('comPort', '');
    const connected = await window.openscope.serial.isConnected();

    this.settingsModal.show({
      cameraDeviceId,
      comPort,
      sweep: this.sweepSettings,
      motor: this.motorSettings,
    }, connected);
  }

  // ---- Autofocus ----

  private async toggleAutofocus() {
    if (this.mode === 'sweeping' || this.mode === 'focusing') {
      this.stop();
      return;
    }
    if (this.mode !== 'idle') return;

    const connected = await window.openscope.serial.isConnected();
    if (!connected || !this.camera.ready) return;

    this.mode = 'sweeping';
    this.toolbar.setFocusActive(true);
    this.sweepData = [];
    this.hud.clearSweep();

    try {
      const { range, stepInterval } = this.sweepSettings;
      const totalCaptures = Math.max(1, Math.floor(range / stepInterval));
      const halfRange = Math.floor(range / 2);

      this.hud.setSweep(0, totalCaptures);

      await window.openscope.serial.send(`LEFT ${halfRange}`);
      await sleep(80);

      for (let i = 0; i < totalCaptures; i++) {
        if (this.mode !== 'sweeping') break;

        await window.openscope.serial.send(`RIGHT ${stepInterval}`);
        await sleep(60);

        const bitmap = await this.camera.captureBitmap(640);
        if (bitmap) {
          const workerPromise = new Promise<number>((resolve) => {
            this.workerResolve = resolve;
          });
          this.worker.postMessage(bitmap, [bitmap]);
          await workerPromise;
        }

        this.hud.setSweep(i + 1, totalCaptures);
      }

      if (this.mode === 'sweeping' && this.sweepData.length > 0) {
        this.mode = 'focusing';
        const bestIdx = this.sweepData.reduce(
          (best, p, i) => (p.score > this.sweepData[best].score ? i : best), 0
        );
        const bestScore = this.sweepData[bestIdx].score;
        const stepsBack = (totalCaptures - 1 - bestIdx) * stepInterval;

        if (stepsBack > 0) {
          await window.openscope.serial.send(`LEFT ${stepsBack}`);
        } else if (stepsBack < 0) {
          await window.openscope.serial.send(`RIGHT ${-stepsBack}`);
        }

        this.hud.setFocusScore(bestScore);
      }
    } catch (err) {
      console.error('Autofocus error:', err);
    }

    this.mode = 'idle';
    this.toolbar.setFocusActive(false);
    this.hud.setSweep(-1, -1);
  }

  private async stop() {
    if (this.mode === 'sweeping' || this.mode === 'jogging' || this.mode === 'focusing') {
      this.mode = 'idle';
      this.toolbar.setFocusActive(false);
      try { await window.openscope.serial.send('STOP'); } catch {}
    }
  }

  private async jog(dir: -1 | 1) {
    if (this.mode !== 'idle') return;
    const connected = await window.openscope.serial.isConnected();
    if (!connected) return;

    this.mode = 'jogging';
    const cmd = dir === 1 ? 'RIGHT 20' : 'LEFT 20';
    try { await window.openscope.serial.send(cmd); } catch {}
    this.mode = 'idle';
  }

  private async zeroPosition() {
    const connected = await window.openscope.serial.isConnected();
    if (!connected) return;
    try {
      await window.openscope.serial.send('ZERO');
      this.currentPosition = 0;
      this.hud.setPosition(0);
    } catch {}
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.ts
git commit -m "feat: integrate UartLog, use structured position/connection events from SerialService"
```

---

### Task 8: Full build verification

- [ ] **Step 1: Run TypeScript check on full project**

Run: `npx tsc --noEmit`
Expected: No errors across all files.

- [ ] **Step 2: Run Vite build**

Run: `npx vite build`
Expected: Build succeeds without errors.

- [ ] **Step 3: Commit any remaining changes**

```bash
git status
git add -A
git commit -m "chore: final build verification after firmware compat + logging changes"
```
