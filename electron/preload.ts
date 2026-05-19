import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('openscope', {
  serial: {
    listPorts: () => ipcRenderer.invoke('serial:list'),
    connect: (path: string, baudRate: number) =>
      ipcRenderer.invoke('serial:connect', path, baudRate),
    disconnect: () => ipcRenderer.invoke('serial:disconnect'),
    send: (command: string) => ipcRenderer.invoke('serial:send'),
    isConnected: () => ipcRenderer.invoke('serial:is-connected'),
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
});
