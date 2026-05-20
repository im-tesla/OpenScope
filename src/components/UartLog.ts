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
  private filterSelect!: HTMLSelectElement;
  private searchInput!: HTMLInputElement;
  private pauseBtn!: HTMLButtonElement;

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
