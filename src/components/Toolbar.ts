export class Toolbar {
  el: HTMLDivElement;
  private focusBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private zeroBtn: HTMLButtonElement;
  private settingsBtn: HTMLButtonElement;
  private uartBtn: HTMLButtonElement;

  onFocus: (() => void) | null = null;
  onStop: (() => void) | null = null;
  onZero: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onUartToggle: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; right: 0; top: 38px; bottom: 0;
      width: 58px; display: flex; flex-direction: column;
      align-items: center; gap: 6px; padding: 10px 0;
      background: rgba(9,9,11,0.85);
      border-left: 1px solid rgba(139,92,246,0.06);
      z-index: 10;
    `;

    this.focusBtn = this.makeIcon(
      `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><polygon points="5,2 15,10 5,18"/></svg>`,
      'Autofocus (Space)'
    );
    this.stopBtn = this.makeIcon(
      `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><rect x="3" y="3" width="14" height="14" rx="1.5"/></svg>`,
      'Stop (Esc)'
    );
    this.stopBtn.classList.add('danger');

    this.zeroBtn = this.makeIcon(
      `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M14 5v2a4 4 0 0 1-4 4H4"/>
        <polyline points="8,5 4,2 8,1"/>
      </svg>`,
      'Zero position (Z)'
    );

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    this.el.appendChild(spacer);

    this.settingsBtn = this.makeIcon(
      `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4">
        <circle cx="10" cy="10" r="3"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2
        M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"/>
      </svg>`,
      'Settings (S)'
    );

    this.focusBtn.onclick = () => this.onFocus?.();
    this.stopBtn.onclick = () => this.onStop?.();
    this.zeroBtn.onclick = () => this.onZero?.();
    this.settingsBtn.onclick = () => this.onSettings?.();

    this.uartBtn = this.makeIcon(
      `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4">
        <rect x="2" y="5" width="16" height="10" rx="2"/>
        <path d="M6 9l3 3 5-5"/>
      </svg>`,
      'UART Log'
    );

    this.uartBtn.onclick = () => this.onUartToggle?.();
  }

  private makeIcon(svg: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.innerHTML = svg;
    btn.title = title;
    btn.className = 'toolbar-btn';
    this.el.appendChild(btn);
    return btn;
  }

  setFocusActive(active: boolean) {
    this.focusBtn.classList.toggle('active', active);
    if (active) {
      this.focusBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><rect x="3" y="3" width="14" height="14" rx="1.5"/></svg>`;
    } else {
      this.focusBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><polygon points="5,2 15,10 5,18"/></polygon></svg>`;
    }
  }

  setEnabled(v: boolean) {
    [this.focusBtn, this.stopBtn, this.zeroBtn].forEach(b => {
      b.style.opacity = v ? '1' : '0.35';
      b.style.pointerEvents = v ? 'auto' : 'none';
    });
  }
}
