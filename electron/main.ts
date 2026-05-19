import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import * as path from 'path';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { SettingsStore } from './settings';

let mainWindow: BrowserWindow | null = null;
let port: SerialPort | null = null;
let settings: SettingsStore;

type PendingCommand = {
  resolve: (data: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let pending: PendingCommand | null = null;
let serialReady = false;

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
    disconnectSerial();
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

// ---- Serial ----

function disconnectSerial() {
  serialReady = false;
  if (pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Disconnected'));
    pending = null;
  }
  if (port?.isOpen) {
    port.close();
  }
  port = null;
}

function sendToRenderer(channel: string, data: unknown) {
  mainWindow?.webContents.send(channel, data);
}

ipcMain.handle('serial:list', async () => {
  const ports = await SerialPort.list();
  return ports.map(p => ({ path: p.path, manufacturer: p.manufacturer, pnpId: p.pnpId }));
});

ipcMain.handle('serial:connect', async (_e, path: string, baudRate: number) => {
  disconnectSerial();

  port = new SerialPort({ path, baudRate });
  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

  parser.on('data', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (pending && serialReady) {
      clearTimeout(pending.timer);
      pending.resolve(trimmed);
      pending = null;
      return;
    }

    sendToRenderer('serial:data', trimmed);
  });

  port.on('close', () => {
    port = null;
    sendToRenderer('serial:disconnected', 'Port closed');
  });

  port.on('error', (err) => {
    sendToRenderer('serial:error', err.message);
  });

  return new Promise<void>((resolve) => {
    const bootTimer = setTimeout(() => {
      resolve();
    }, 2000);

    parser.once('data', (line: string) => {
      clearTimeout(bootTimer);
      serialReady = true;
      sendToRenderer('serial:data', line.trim());
      resolve();
    });
  });
});

ipcMain.handle('serial:disconnect', async () => {
  disconnectSerial();
});

ipcMain.handle('serial:send', async (_e, command: string) => {
  if (!port?.isOpen) throw new Error('Not connected');
  if (!serialReady) throw new Error('Serial not ready');

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null;
      reject(new Error('Command timeout'));
    }, 5000);

    pending = { resolve, reject, timer };
    port!.write(command + '\n');
  });
});

ipcMain.handle('serial:is-connected', async () => {
  return port?.isOpen ?? false;
});

// ---- Settings ----

ipcMain.handle('settings:get', async (_e, key: string, fallback: unknown) => {
  return settings.get(key, fallback);
});

ipcMain.handle('settings:set', async (_e, key: string, value: unknown) => {
  settings.set(key, value);
});

ipcMain.handle('settings:getAll', async () => {
  return settings.getAll();
});

// ---- App lifecycle ----

app.whenReady().then(() => {
  settings = new SettingsStore();
  createWindow();
});

app.on('window-all-closed', () => {
  disconnectSerial();
  app.quit();
});

app.on('before-quit', () => {
  disconnectSerial();
});
