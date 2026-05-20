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
      try {
        this.stream = fs.createWriteStream(this.logPath(today), { flags: 'a' });
      } catch (err) {
        console.error('Logger: failed to create log stream:', err);
        this.stream = null;
      }
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
        const fileDate = new Date(match[1] + 'T00:00:00');
        if (fileDate < cutoff) {
          try { fs.unlinkSync(path.join(this.logDir, file)); } catch { /* best effort */ }
        }
      }
    }
  }

  dispose(): Promise<void> {
    return new Promise((resolve) => {
      if (this.stream) {
        this.stream.end(() => {
          this.stream = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
