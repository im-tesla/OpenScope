export interface PortInfo {
  path: string;
  manufacturer?: string;
  pnpId?: string;
}

export interface SerialApi {
  listPorts: () => Promise<PortInfo[]>;
  connect: (path: string, baudRate: number) => Promise<void>;
  disconnect: () => Promise<void>;
  send: (command: string) => Promise<string>;
  isConnected: () => Promise<boolean>;
  onData: (cb: (data: string) => void) => () => void;
  onDisconnected: (cb: (error?: string) => void) => () => void;
  onError: (cb: (msg: string) => void) => () => void;
}

export interface SettingsApi {
  get: <T>(key: string, fallback: T) => Promise<T>;
  set: (key: string, value: unknown) => Promise<void>;
  getAll: () => Promise<Record<string, unknown>>;
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
    };
  }
}
