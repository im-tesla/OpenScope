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
  // Callback -> renderer helpers
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

function setupSettingsIPC() {
  ipcMain.handle('settings:get', async (_e, key: string, fallback: unknown) => {
    return settings.get(key, fallback);
  });

  ipcMain.handle('settings:set', async (_e, key: string, value: unknown) => {
    settings.set(key, value);
  });

  ipcMain.handle('settings:getAll', async () => {
    return settings.getAll();
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
  setupSettingsIPC();
  setupSerialIPC();
  setupLogIPC();
});

app.on('window-all-closed', async () => {
  serialService.disconnect();
  await logger.dispose();
  app.quit();
});

app.on('before-quit', () => {
  serialService.disconnect();
});
