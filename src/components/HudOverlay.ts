import type { FocusPoint } from '../engine/state';

export class HudOverlay {
  el: HTMLDivElement;
  private focusScoreEl: HTMLSpanElement;
  private positionEl: HTMLSpanElement;
  private sweepEl: HTMLSpanElement;
  private statusDot: HTMLDivElement;
  private sparklineCanvas: HTMLCanvasElement;
  private sparklineCtx: CanvasRenderingContext2D;
  private jogLeftBtn: HTMLButtonElement;
  private jogRightBtn: HTMLButtonElement;
  private zeroBtn: HTMLButtonElement;
  private points: FocusPoint[] = [];

  onJog: ((dir: -1 | 1) => void) | null = null;
  onZero: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'glass-panel';
    this.el.style.cssText = `
      position: absolute; bottom: 16px; left: 16px;
      padding: 14px 18px; display: flex; flex-direction: column; gap: 6px;
      min-width: 260px; border-radius: 6px; z-index: 10;
    `;

    // Row 1: Status + label
    const row1 = document.createElement('div');
    row1.style.cssText = 'display:flex; align-items:center; gap:8px;';
    this.statusDot = document.createElement('span');
    this.statusDot.className = 'status-dot off';
    row1.appendChild(this.statusDot);
    const comLabel = document.createElement('span');
    comLabel.style.cssText = 'font-size:11px; font-weight:500; letter-spacing:0.06em; text-transform:uppercase; color:#71717a;';
    comLabel.textContent = 'Module';

    const posLabel = document.createElement('span');
    posLabel.style.cssText = 'font-size:10px; color:#52525b; letter-spacing:0.04em;';
    posLabel.textContent = 'UART 115200';
    row1.appendChild(comLabel);

    const spacer1 = document.createElement('span');
    spacer1.style.flex = '1';
    row1.appendChild(spacer1);
    row1.appendChild(posLabel);
    this.el.appendChild(row1);

    // Row 2: Focus Score — BIG
    const row2 = document.createElement('div');
    row2.style.cssText = 'display:flex; align-items:baseline; gap:10px;';
    const focusLabel = document.createElement('span');
    focusLabel.style.cssText = 'font-size:10px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#52525b;';
    focusLabel.textContent = 'Focus';
    this.focusScoreEl = document.createElement('span');
    this.focusScoreEl.className = 'hud-value';
    this.focusScoreEl.style.cssText = 'font-size:36px; font-weight:500; line-height:1; color:#a78bfa; letter-spacing:-0.02em;';
    this.focusScoreEl.textContent = '--';
    row2.appendChild(focusLabel);
    row2.appendChild(this.focusScoreEl);
    this.el.appendChild(row2);

    // Row 3: Position + Sweep progress
    const row3 = document.createElement('div');
    row3.style.cssText = 'display:flex; gap:16px; align-items:center;';
    this.positionEl = document.createElement('span');
    this.positionEl.className = 'hud-value';
    this.positionEl.style.cssText = 'font-size:13px; color:#d4d4d8; font-weight:400;';
    this.positionEl.textContent = 'POS --';
    this.sweepEl = document.createElement('span');
    this.sweepEl.className = 'hud-value';
    this.sweepEl.style.cssText = 'font-size:12px; color:#71717a;';
    this.sweepEl.textContent = '';
    row3.appendChild(this.positionEl);
    row3.appendChild(this.sweepEl);
    this.el.appendChild(row3);

    // Sparkline
    this.sparklineCanvas = document.createElement('canvas');
    this.sparklineCanvas.width = 256;
    this.sparklineCanvas.height = 48;
    this.sparklineCanvas.style.cssText = 'width:256px; height:48px; margin: 2px 0; border-radius:2px;';
    this.sparklineCtx = this.sparklineCanvas.getContext('2d')!;
    this.el.appendChild(this.sparklineCanvas);

    // Row 4: Jog
    const row4 = document.createElement('div');
    row4.style.cssText = 'display:flex; align-items:center; gap:5px;';
    this.jogLeftBtn = document.createElement('button');
    this.jogLeftBtn.innerHTML = '&#9664;';
    this.jogLeftBtn.title = 'Jog left (←)';
    this.jogLeftBtn.className = 'jog-btn';
    this.jogRightBtn = document.createElement('button');
    this.jogRightBtn.innerHTML = '&#9654;';
    this.jogRightBtn.title = 'Jog right (→)';
    this.jogRightBtn.className = 'jog-btn';
    this.zeroBtn = document.createElement('button');
    this.zeroBtn.innerHTML = '&#8634;';
    this.zeroBtn.title = 'Zero position';
    this.zeroBtn.className = 'jog-btn';

    this.jogLeftBtn.onclick = () => this.onJog?.(-1);
    this.jogRightBtn.onclick = () => this.onJog?.(1);
    this.zeroBtn.onclick = () => this.onZero?.();

    row4.appendChild(this.jogLeftBtn);
    row4.appendChild(this.jogRightBtn);
    row4.appendChild(this.zeroBtn);

    const jogLabel = document.createElement('span');
    jogLabel.style.cssText = 'font-size:9px; color:#52525b; margin-left:2px;';
    jogLabel.textContent = 'Jog';
    row4.appendChild(jogLabel);
    this.el.appendChild(row4);
  }

  setConnected(v: boolean) {
    this.statusDot.className = v ? 'status-dot on' : 'status-dot off';
  }

  setFocusScore(v: number | null) {
    this.focusScoreEl.textContent = v != null ? v.toFixed(1) : '--';
  }

  setPosition(v: number | null) {
    this.positionEl.textContent = v != null ? `POS ${v.toLocaleString()}` : 'POS --';
  }

  setSweep(current: number, total: number) {
    this.sweepEl.textContent = total > 0 ? `Z ${current}/${total}` : '';
  }

  addFocusPoint(p: FocusPoint) {
    this.points.push(p);
    this.drawSparkline();
  }

  clearSweep() {
    this.points = [];
    this.drawSparkline();
    this.sweepEl.textContent = '';
  }

  private drawSparkline() {
    const ctx = this.sparklineCtx;
    const w = this.sparklineCanvas.width;
    const h = this.sparklineCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const pts = this.points;
    if (pts.length < 2) return;

    const scores = pts.map(p => p.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min || 1;
    const pad = 6;

    // Fill area under curve
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p.score - min) / range) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, h - pad);
      ctx.lineTo(x, y);
    });
    ctx.lineTo(pad + (pts.length - 1) / (pts.length - 1) * (w - pad * 2), h - pad);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(139, 92, 246, 0.25)');
    grad.addColorStop(1, 'rgba(139, 92, 246, 0.02)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    pts.forEach((p, i) => {
      const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p.score - min) / range) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Best point
    const best = pts.reduce((a, b) => (a.score > b.score ? a : b));
    const bi = pts.indexOf(best);
    const bx = pad + (bi / (pts.length - 1)) * (w - pad * 2);
    const by = h - pad - ((best.score - min) / range) * (h - pad * 2);
    ctx.beginPath();
    ctx.fillStyle = '#8b5cf6';
    ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = '#c4b5fd';
    ctx.lineWidth = 1;
    ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  setJogEnabled(v: boolean) {
    this.jogLeftBtn.disabled = !v;
    this.jogRightBtn.disabled = !v;
    this.zeroBtn.disabled = !v;
  }
}
