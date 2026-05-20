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
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private syncInProgress = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

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

      // Resolve pending command if one is waiting (but not during motor sync)
      if (this.pending && this.serialReady && !this.syncInProgress) {
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
      this.serialReady = false;
      this.emitConnectionState('disconnected');
      this.logger.error('serial', err.message);
    });

    return new Promise<void>((resolve) => {
      let resolved = false;
      this.bootTimer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.bootTimer = null;
        this.serialReady = true;
        this.emitConnectionState('connected');
        this.logger.info('serial', `Connected to ${path}`);
        this.syncMotorParams();
        resolve();
      }, 2000);

      parser.once('data', (line: string) => {
        if (resolved) return;
        resolved = true;
        if (this.bootTimer) {
          clearTimeout(this.bootTimer);
          this.bootTimer = null;
        }
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
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
      this.syncInProgress = false;
    }
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
    if (this.pending) throw new Error('Command already in progress');

    // Wait for motor sync to finish so sync responses don't eat this command's reply
    while (this.syncInProgress) {
      await new Promise(r => setTimeout(r, 10));
    }

    return new Promise<string>((resolve, reject) => {
      const captured: PendingCommand = {
        resolve,
        reject,
        timer: setTimeout(() => {
          if (this.pending === captured) {
            this.pending = null;
          }
          reject(new Error('Command timeout'));
        }, 5000),
      };

      this.pending = captured;
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
    this.syncInProgress = true;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncInProgress = false;
      this.syncTimer = null;
    }, 1000);

    this.writeRaw(`SPEED ${m.speed}\n`);
    this.writeRaw(`ACCEL ${m.acceleration}\n`);
    this.writeRaw(`PULSE ${m.pulseWidth}\n`);
    this.writeRaw(`HOLD ${m.holdTime}\n`);
    this.writeRaw(`STATUS\n`);
    this.logger.info('serial', `Motor params synced: speed=${m.speed}, accel=${m.acceleration}, pulse=${m.pulseWidth}, hold=${m.holdTime}`);
  }
}
