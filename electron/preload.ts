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
