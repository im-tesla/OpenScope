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
