export class CameraView {
  el: HTMLDivElement;
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private placeholder: HTMLDivElement;
  private _ready = false;

  get ready() { return this._ready; }

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute; top:38px; left:0; right:58px; bottom:0; background:#000;';

    this.video = document.createElement('video');
    this.video.style.cssText = 'width:100%; height:100%; object-fit:contain;';
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.el.appendChild(this.video);

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;

    this.placeholder = document.createElement('div');
    this.placeholder.style.cssText = `
      position: absolute; inset: 0; display: flex;
      align-items: center; justify-content: center;
      flex-direction: column; gap: 12px;
      color: #3f3f46; font-size: 15px; font-weight: 500;
      letter-spacing: 0.02em;
    `;
    const icon = document.createElement('div');
    icon.innerHTML = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#27272a" stroke-width="1.5">
      <rect x="4" y="12" width="40" height="28" rx="3"/><circle cx="24" cy="26" r="9"/>
      <circle cx="24" cy="26" r="3" fill="#18181b" stroke="#18181b"/></svg>`;
    const text = document.createElement('span');
    text.textContent = 'Camera not connected';
    text.id = 'cam-placeholder-text';
    this.placeholder.appendChild(icon);
    this.placeholder.appendChild(text);
    this.el.appendChild(this.placeholder);
  }

  async start(deviceId?: string) {
    await this.stop();

    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: 1920, height: 1080 }
        : { width: 1920, height: 1080 },
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();

      this.video.addEventListener('loadedmetadata', () => {
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
      });

      this._ready = true;
      this.placeholder.style.display = 'none';

    } catch (err) {
      this._ready = false;
      const txt = this.placeholder.querySelector('#cam-placeholder-text');
      if (txt) {
        txt.textContent = (err as Error).name === 'NotAllowedError'
          ? 'Camera permission denied'
          : 'No camera found';
      }
      this.placeholder.style.display = 'flex';
    }
  }

  async stop() {
    this._ready = false;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.placeholder.style.display = 'flex';
  }

  async captureBitmap(resizeWidth = 640): Promise<ImageBitmap | null> {
    if (!this._ready || this.video.readyState < 3) return null;

    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (vw === 0 || vh === 0) return null;

    this.canvas.width = vw;
    this.canvas.height = vh;
    this.ctx.drawImage(this.video, 0, 0);

    const ratio = resizeWidth / vw;
    return createImageBitmap(this.canvas, {
      resizeWidth: Math.round(vw * ratio),
      resizeHeight: Math.round(vh * ratio),
      resizeQuality: 'low',
    });
  }

  static async list(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  }
}
