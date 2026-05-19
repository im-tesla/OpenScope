import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export class SettingsStore {
  private file: string;
  private data: Record<string, unknown>;

  constructor() {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'settings.json');
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
    } catch {
      this.data = {};
    }
  }

  get<T>(key: string, fallback: T): T {
    return key in this.data ? (this.data[key] as T) : fallback;
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  getAll(): Record<string, unknown> {
    return { ...this.data };
  }
}
