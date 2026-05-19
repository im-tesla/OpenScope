import type { SweepParams, MotorParams } from '../engine/state';
import { defaultSweep, defaultMotor } from '../engine/state';

export interface SettingsData {
  cameraDeviceId: string;
  comPort: string;
  sweep: SweepParams;
  motor: MotorParams;
}

export class SettingsModal {
  el: HTMLDivElement;
  private cameraSelect: HTMLSelectElement;
  private comSelect: HTMLSelectElement;
  private comStatus: HTMLSpanElement;
  private refreshBtn: HTMLButtonElement;
  private rangeInput: HTMLInputElement;
  private stepInput: HTMLInputElement;
  private speedInput: HTMLInputElement;
  private accelInput: HTMLInputElement;
  private pulseInput: HTMLInputElement;
  private holdInput: HTMLInputElement;

  onSave: ((data: SettingsData) => void) | null = null;
  onClose: (() => void) | null = null;
  onRefreshDevices: (() => Promise<{
    cameras: { deviceId: string; label: string }[];
    comPorts: { path: string; label: string }[];
  }>) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'modal-overlay';
    this.el.style.cssText = `
      position: absolute; inset: 0; z-index: 50;
      display: none; align-items: center; justify-content: center;
    `;
    this.el.onclick = () => this.hide();

    const card = document.createElement('div');
    card.style.cssText = `
      width: 500px; max-height: 92vh; overflow-y: auto;
      background: #18181b; border: 1px solid #27272a;
      border-radius: 8px; padding: 28px;
      display: flex; flex-direction: column; gap: 18px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    `;
    card.onclick = (e) => e.stopPropagation();

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between;';
    const title = document.createElement('h2');
    title.style.cssText = 'font-size:15px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#e4e4e7;';
    title.textContent = 'Settings';
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&#10005;';
    closeBtn.style.cssText = 'background:none; border:none; color:#52525b; font-size:16px; cursor:pointer; padding:4px 8px; border-radius:3px;';
    closeBtn.onmouseenter = () => { closeBtn.style.color = '#e4e4e7'; closeBtn.style.background = '#27272a'; };
    closeBtn.onmouseleave = () => { closeBtn.style.color = '#52525b'; closeBtn.style.background = 'none'; };
    closeBtn.onclick = () => this.hide();
    header.appendChild(title);
    header.appendChild(closeBtn);
    card.appendChild(header);

    // Camera
    card.appendChild(this.sectionLabel('Camera'));
    this.cameraSelect = this.makeSelect();
    card.appendChild(this.cameraSelect);

    // COM
    card.appendChild(this.sectionLabel('Autofocus Module'));
    const comRow = document.createElement('div');
    comRow.style.cssText = 'display:flex; align-items:center; gap:8px;';
    this.comSelect = this.makeSelect();
    this.comSelect.style.flex = '1';
    this.comStatus = document.createElement('span');
    this.comStatus.style.cssText = 'font-size:12px; white-space:nowrap;';
    comRow.appendChild(this.comSelect);
    comRow.appendChild(this.comStatus);
    card.appendChild(comRow);

    this.refreshBtn = document.createElement('button');
    this.refreshBtn.textContent = 'Refresh devices';
    this.refreshBtn.style.cssText = `
      background: none; border: none; color: #8b5cf6; font-size: 12px;
      font-weight: 500; cursor: pointer; align-self: flex-start; padding: 0;
      letter-spacing: 0.02em;
    `;
    this.refreshBtn.onmouseenter = () => { this.refreshBtn.style.color = '#a78bfa'; };
    this.refreshBtn.onmouseleave = () => { this.refreshBtn.style.color = '#8b5cf6'; };
    this.refreshBtn.onclick = () => this.refreshDevices();
    card.appendChild(this.refreshBtn);

    // Sweep
    card.appendChild(this.sectionLabel('Sweep Parameters'));
    this.rangeInput = this.makeField('1000');
    this.stepInput = this.makeField('50');
    card.appendChild(this.formRow('Range', this.rangeInput, 'steps'));
    card.appendChild(this.formRow('Step interval', this.stepInput, 'steps'));

    // Motor
    card.appendChild(this.sectionLabel('Motor'));
    this.speedInput = this.makeField('3000');
    this.accelInput = this.makeField('8000');
    this.pulseInput = this.makeField('3');
    this.holdInput = this.makeField('0');
    card.appendChild(this.formRow('Speed', this.speedInput, 'steps/s'));
    card.appendChild(this.formRow('Acceleration', this.accelInput, 'steps/s²'));
    card.appendChild(this.formRow('Pulse width', this.pulseInput, 'μs'));
    card.appendChild(this.formRow('Hold time', this.holdInput, 'ms'));

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:8px; justify-content:flex-end; margin-top:4px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.onclick = () => this.hide();
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'btn-primary';
    saveBtn.onclick = () => this.handleSave();
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    card.appendChild(btnRow);

    this.el.appendChild(card);
  }

  private sectionLabel(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:10px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:#52525b; margin-top:2px;';
    el.textContent = text;
    return el;
  }

  private makeSelect(): HTMLSelectElement {
    const s = document.createElement('select');
    s.className = 'settings-field settings-select';
    return s;
  }

  private makeField(placeholder: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'settings-field';
    input.placeholder = placeholder;
    return input;
  }

  private formRow(label: string, input: HTMLInputElement, unit: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:10px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:13px; color:#a1a1aa; width:110px; flex-shrink:0;';
    lbl.textContent = label;
    const unitEl = document.createElement('span');
    unitEl.style.cssText = 'font-size:11px; color:#52525b; width:56px; flex-shrink:0;';
    unitEl.textContent = unit;
    row.appendChild(lbl);
    row.appendChild(input);
    row.appendChild(unitEl);
    return row;
  }

  show(current: SettingsData, comConnected: boolean) {
    this.el.style.display = 'flex';
    if (current.cameraDeviceId) this.cameraSelect.value = current.cameraDeviceId;
    if (current.comPort) this.comSelect.value = current.comPort;
    this.rangeInput.value = String(current.sweep.range);
    this.stepInput.value = String(current.sweep.stepInterval);
    this.speedInput.value = String(current.motor.speed);
    this.accelInput.value = String(current.motor.acceleration);
    this.pulseInput.value = String(current.motor.pulseWidth);
    this.holdInput.value = String(current.motor.holdTime);

    this.setComStatus(comConnected);
    this.refreshDevices();
  }

  hide() {
    this.el.style.display = 'none';
    this.onClose?.();
  }

  private async refreshDevices() {
    if (!this.onRefreshDevices) return;
    const { cameras, comPorts } = await this.onRefreshDevices();
    const prevCam = this.cameraSelect.value;
    const prevCom = this.comSelect.value;

    this.cameraSelect.innerHTML = cameras
      .map(c => `<option value="${c.deviceId}">${c.label}</option>`)
      .join('');
    if (cameras.some(c => c.deviceId === prevCam)) this.cameraSelect.value = prevCam;

    this.comSelect.innerHTML = comPorts
      .map(c => `<option value="${c.path}">${c.label}</option>`)
      .join('');
    if (comPorts.some(c => c.path === prevCom)) this.comSelect.value = prevCom;
  }

  setComStatus(connected: boolean) {
    this.comStatus.textContent = connected ? '⬤ Connected' : 'Disconnected';
    this.comStatus.style.color = connected ? '#22c55e' : '#52525b';
  }

  private handleSave() {
    const data: SettingsData = {
      cameraDeviceId: this.cameraSelect.value,
      comPort: this.comSelect.value,
      sweep: {
        range: parseInt(this.rangeInput.value) || defaultSweep.range,
        stepInterval: parseInt(this.stepInput.value) || defaultSweep.stepInterval,
      },
      motor: {
        speed: parseFloat(this.speedInput.value) || defaultMotor.speed,
        acceleration: parseFloat(this.accelInput.value) || defaultMotor.acceleration,
        pulseWidth: parseInt(this.pulseInput.value) || defaultMotor.pulseWidth,
        holdTime: parseInt(this.holdInput.value) || defaultMotor.holdTime,
      },
    };
    this.onSave?.(data);
    this.hide();
  }
}
