import { CameraView } from './components/CameraView';
import { HudOverlay } from './components/HudOverlay';
import { Toolbar } from './components/Toolbar';
import { UartLog } from './components/UartLog';
import { SettingsModal, type SettingsData } from './components/SettingsModal';
import type { AppMode, FocusPoint, SweepParams, MotorParams } from './engine/state';
import { defaultSweep, defaultMotor } from './engine/state';

export class App {
  camera: CameraView;
  hud: HudOverlay;
  toolbar: Toolbar;
  uartLog: UartLog;
  settingsModal: SettingsModal;
  worker: Worker;

  private mode: AppMode = 'idle';
  private sweepData: FocusPoint[] = [];
  private sweepSettings = { ...defaultSweep };
  private motorSettings = { ...defaultMotor };
  private currentPosition: number | null = null;
  private workerResolve: ((score: number) => void) | null = null;

  constructor() {
    this.camera = new CameraView();
    this.hud = new HudOverlay();
    this.toolbar = new Toolbar();
    this.uartLog = new UartLog();
    this.settingsModal = new SettingsModal();
    this.worker = new Worker(new URL('./engine/worker.ts', import.meta.url), { type: 'module' });
  }

  async init() {
    const app = document.getElementById('app')!;

    this.buildTitleBar(app);
    this.buildResizeHandles(app);

    app.appendChild(this.camera.el);
    app.appendChild(this.hud.el);
    app.appendChild(this.toolbar.el);
    app.appendChild(this.uartLog.el);
    app.appendChild(this.settingsModal.el);

    this.bindEvents();
    await this.loadAndApplySettings();
    this.setupKeyboard();
    this.setupSerialListeners();
    this.uartLog.listen();

    // Persist uartLog visibility
    const uartOpen = await window.openscope.settings.get<boolean>('uartLogOpen', false);
    if (uartOpen) this.uartLog.show();
  }

  private buildTitleBar(container: HTMLElement) {
    const bar = document.createElement('div');
    bar.className = 'titlebar';

    const label = document.createElement('span');
    label.className = 'titlebar-label';
    label.textContent = 'OpenScope';

    const ctrls = document.createElement('div');
    ctrls.className = 'titlebar-ctrls';

    const minBtn = this.makeTitleBtn('&#9472;', 'min');
    minBtn.onclick = () => window.openscope.window.minimize();
    const maxBtn = this.makeTitleBtn('&#9723;', 'max');
    maxBtn.onclick = async () => {
      await window.openscope.window.maximize();
      maxBtn.innerHTML = (await window.openscope.window.isMaximized()) ? '&#9634;' : '&#9723;';
    };
    const closeBtn = this.makeTitleBtn('&#10005;', 'close');
    closeBtn.classList.add('close');
    closeBtn.onclick = () => window.openscope.window.close();

    ctrls.appendChild(minBtn);
    ctrls.appendChild(maxBtn);
    ctrls.appendChild(closeBtn);
    bar.appendChild(label);
    bar.appendChild(ctrls);
    container.appendChild(bar);

    bar.addEventListener('dblclick', () => window.openscope.window.maximize());
  }

  private makeTitleBtn(html: string, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.innerHTML = html;
    btn.className = 'titlebar-btn';
    btn.title = label;
    return btn;
  }

  private buildResizeHandles(container: HTMLElement) {
    const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    for (const e of edges) {
      const div = document.createElement('div');
      div.className = `resize-${e}`;
      container.appendChild(div);
    }
  }

  private bindEvents() {
    this.toolbar.onFocus = () => this.toggleAutofocus();
    this.toolbar.onStop = () => this.stop();
    this.toolbar.onZero = () => this.zeroPosition();
    this.toolbar.onSettings = () => this.openSettings();
    this.toolbar.onUartToggle = () => this.toggleUartLog();

    this.hud.onJog = (dir) => this.jog(dir);
    this.hud.onZero = () => this.zeroPosition();

    this.uartLog.onClose = () => {
      window.openscope.settings.set('uartLogOpen', false);
    };

    this.settingsModal.onSave = (data) => this.applySettings(data);

    this.settingsModal.onRefreshDevices = async () => {
      const cameras = await CameraView.list();
      const comPorts = await window.openscope.serial.listPorts();
      return {
        cameras: cameras.map(c => ({
          deviceId: c.deviceId,
          label: c.label || `Camera ${c.deviceId.slice(0, 8)}`,
        })),
        comPorts: comPorts.map(p => ({
          path: p.path,
          label: `${p.path}${p.manufacturer ? ' - ' + p.manufacturer : ''}`,
        })),
      };
    };

    this.worker.onmessage = (e: MessageEvent<{ score: number }>) => {
      const score = e.data.score;
      if (this.mode === 'sweeping') {
        this.sweepData.push({ position: this.currentPosition ?? this.sweepData.length, score });
        this.hud.addFocusPoint({ position: this.sweepData.length, score });
        this.hud.setFocusScore(score);
      }
      if (this.workerResolve) {
        this.workerResolve(score);
        this.workerResolve = null;
      }
    };
  }

  private setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (this.settingsModal.el.style.display === 'flex') return;
      switch (e.key) {
        case 'ArrowLeft':  e.preventDefault(); this.jog(-1); break;
        case 'ArrowRight': e.preventDefault(); this.jog(1); break;
        case ' ':          e.preventDefault(); this.toggleAutofocus(); break;
        case 'Escape':     e.preventDefault(); this.stop(); break;
        case 'z':          if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); this.zeroPosition(); } break;
        case 's':          if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); this.openSettings(); } break;
        case 'l':          if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); this.toggleUartLog(); } break;
      }
    });
  }

  private setupSerialListeners() {
    const api = window.openscope.serial;

    // Structured position updates from SerialService (fixes swallowed POS bug)
    api.onPosition((payload) => {
      this.currentPosition = payload.position;
      this.hud.setPosition(payload.position);
    });

    // Connection state tracking
    api.onConnectionState((payload) => {
      const connected = payload.state === 'connected';
      this.uartLog.setConnected(connected);

      if (payload.state === 'connected') {
        this.hud.setConnected(true);
        this.toolbar.setEnabled(true);
        this.hud.setJogEnabled(true);
      } else if (payload.state === 'disconnected') {
        this.hud.setConnected(false);
        this.toolbar.setEnabled(false);
        this.hud.setJogEnabled(false);
        if (this.mode === 'sweeping' || this.mode === 'focusing') {
          this.mode = 'error';
          this.toolbar.setFocusActive(false);
        }
        if (this.workerResolve) {
          this.workerResolve(0);
          this.workerResolve = null;
        }
      }
    });

    // Keep raw data listener for backward compat (unsolicited STATUS lines, etc.)
    api.onData((data: string) => {
      // Position is now tracked via onPosition, but keep fallback
      if (data.startsWith('POS ')) {
        const pos = parseInt(data.slice(4), 10);
        if (!isNaN(pos)) {
          this.currentPosition = pos;
          this.hud.setPosition(pos);
        }
      }
      const statusMatch = data.match(/^Position:\s*(-?\d+)/);
      if (statusMatch) {
        const pos = parseInt(statusMatch[1], 10);
        this.currentPosition = pos;
        this.hud.setPosition(pos);
      }
    });

    api.onError((msg: string) => {
      console.error('Serial error:', msg);
    });
  }

  private async loadAndApplySettings() {
    const s = window.openscope.settings;
    const camId = await s.get<string>('cameraDeviceId', '');
    const comPort = await s.get<string>('comPort', '');
    this.sweepSettings = await s.get<SweepParams>('sweep', defaultSweep);
    this.motorSettings = await s.get<MotorParams>('motor', defaultMotor);

    await this.camera.start(camId || undefined);

    // Sync motor params to SerialService before connecting
    await window.openscope.serial.setMotorParams(this.motorSettings);

    if (comPort) {
      try {
        await window.openscope.serial.connect(comPort, 115200);
        // Connection state and motor sync are now handled by SerialService internally
      } catch {
        this.hud.setConnected(false);
      }
    }
  }

  private async applySettings(data: SettingsData) {
    const s = window.openscope.settings;
    await s.set('cameraDeviceId', data.cameraDeviceId);
    await s.set('comPort', data.comPort);
    await s.set('sweep', data.sweep);
    await s.set('motor', data.motor);

    this.sweepSettings = data.sweep;
    this.motorSettings = data.motor;

    // Update SerialService with new motor params
    await window.openscope.serial.setMotorParams(data.motor);

    const prevCam = await s.get<string>('_lastCam', '');
    if (data.cameraDeviceId !== prevCam) {
      await s.set('_lastCam', data.cameraDeviceId);
      await this.camera.start(data.cameraDeviceId || undefined);
    }

    const wasConnected = await window.openscope.serial.isConnected();
    if (!wasConnected && data.comPort) {
      try {
        await window.openscope.serial.connect(data.comPort, 115200);
      } catch {
        this.hud.setConnected(false);
      }
    }
  }

  private toggleUartLog() {
    this.uartLog.toggle();
    window.openscope.settings.set('uartLogOpen', this.uartLog.isVisible());
  }

  private async openSettings() {
    const s = window.openscope.settings;
    const cameraDeviceId = await s.get<string>('cameraDeviceId', '');
    const comPort = await s.get<string>('comPort', '');
    const connected = await window.openscope.serial.isConnected();

    this.settingsModal.show({
      cameraDeviceId,
      comPort,
      sweep: this.sweepSettings,
      motor: this.motorSettings,
    }, connected);
  }

  // ---- Autofocus ----

  private async toggleAutofocus() {
    if (this.mode === 'sweeping' || this.mode === 'focusing') {
      this.stop();
      return;
    }
    if (this.mode !== 'idle') return;

    const connected = await window.openscope.serial.isConnected();
    if (!connected || !this.camera.ready) return;

    this.mode = 'sweeping';
    this.toolbar.setFocusActive(true);
    this.sweepData = [];
    this.hud.clearSweep();

    try {
      const { range, stepInterval } = this.sweepSettings;
      const totalCaptures = Math.max(1, Math.floor(range / stepInterval));
      const halfRange = Math.floor(range / 2);

      this.hud.setSweep(0, totalCaptures);

      await window.openscope.serial.send(`LEFT ${halfRange}`);
      await sleep(80);

      for (let i = 0; i < totalCaptures; i++) {
        if (this.mode !== 'sweeping') break;

        await window.openscope.serial.send(`RIGHT ${stepInterval}`);
        await sleep(60);

        const bitmap = await this.camera.captureBitmap(640);
        if (bitmap) {
          const workerPromise = new Promise<number>((resolve) => {
            this.workerResolve = resolve;
          });
          this.worker.postMessage(bitmap, [bitmap]);
          await workerPromise;
        }

        this.hud.setSweep(i + 1, totalCaptures);
      }

      if (this.mode === 'sweeping' && this.sweepData.length > 0) {
        this.mode = 'focusing';
        const bestIdx = this.sweepData.reduce(
          (best, p, i) => (p.score > this.sweepData[best].score ? i : best), 0
        );
        const bestScore = this.sweepData[bestIdx].score;
        const stepsBack = (totalCaptures - 1 - bestIdx) * stepInterval;

        if (stepsBack > 0) {
          await window.openscope.serial.send(`LEFT ${stepsBack}`);
        } else if (stepsBack < 0) {
          await window.openscope.serial.send(`RIGHT ${-stepsBack}`);
        }

        this.hud.setFocusScore(bestScore);
      }
    } catch (err) {
      console.error('Autofocus error:', err);
    }

    this.mode = 'idle';
    this.toolbar.setFocusActive(false);
    this.hud.setSweep(-1, -1);
  }

  private async stop() {
    if (this.mode === 'sweeping' || this.mode === 'jogging' || this.mode === 'focusing') {
      this.mode = 'idle';
      this.toolbar.setFocusActive(false);
      try { await window.openscope.serial.send('STOP'); } catch {}
    }
  }

  private async jog(dir: -1 | 1) {
    if (this.mode !== 'idle') return;
    const connected = await window.openscope.serial.isConnected();
    if (!connected) return;

    this.mode = 'jogging';
    const cmd = dir === 1 ? 'RIGHT 20' : 'LEFT 20';
    try { await window.openscope.serial.send(cmd); } catch {}
    this.mode = 'idle';
  }

  private async zeroPosition() {
    const connected = await window.openscope.serial.isConnected();
    if (!connected) return;
    try {
      await window.openscope.serial.send('ZERO');
      this.currentPosition = 0;
      this.hud.setPosition(0);
    } catch {}
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
