/*
 * QrScanner - camera QR scanning tuned for real-world asset labels.
 *
 * Strategy (each frame, whole frame - no tiny scan box):
 *   1. Native BarcodeDetector (Android Chrome etc.) when it supports QR - fast, ML based.
 *   2. zxing-wasm in a Web Worker, rotating through passes:
 *        full      - whole frame, LocalAverage binarizer, tryHarder/rotate/invert/downscale
 *        center    - centre crop at native resolution (small / distant codes)
 *        stretch   - grayscale + contrast stretch, GlobalHistogram binarizer (faded, low contrast)
 *        adaptive  - adaptive threshold (shadows, glare, curved/bent labels)
 *        denoise   - wider crop with denoise (noisy low-light frames)
 * Camera: ideal 1920x1080, continuous autofocus, torch, zoom, tap-to-focus, camera switching.
 */
(function () {
  const WORKER_URL = '/js/decoder-worker.js';
  const PASSES = ['full', 'center', 'stretch', 'adaptive', 'full', 'denoise'];
  const CAMERA_KEY = 'scanner_camera_id';

  let worker = null;
  let nextJobId = 1;
  const pending = new Map();

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(WORKER_URL, { type: 'module' });
    worker.onmessage = (e) => {
      const job = pending.get(e.data.id);
      if (job) {
        pending.delete(e.data.id);
        job(e.data);
      }
    };
    worker.onerror = (e) => console.error('Decoder worker error', e.message || e);
    return worker;
  }

  function decodeImageData(imageData, pass) {
    return new Promise((resolve) => {
      const id = nextJobId++;
      pending.set(id, (msg) => resolve(msg.text || null));
      getWorker().postMessage(
        { id, width: imageData.width, height: imageData.height, buffer: imageData.data.buffer, pass },
        [imageData.data.buffer]
      );
    });
  }

  let nativeDetector;
  async function getNativeDetector() {
    if (nativeDetector !== undefined) return nativeDetector;
    nativeDetector = null;
    try {
      if ('BarcodeDetector' in window) {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (supported.includes('qr_code')) {
          const formats = ['qr_code', 'data_matrix', 'code_128'].filter(f => supported.includes(f));
          nativeDetector = new window.BarcodeDetector({ formats });
        }
      }
    } catch (e) {
      nativeDetector = null;
    }
    return nativeDetector;
  }

  // Draw a region of a source (video / bitmap) to a canvas, scaled so the long side <= maxSide.
  function grab(canvas, source, srcW, srcH, cropFraction, maxSide) {
    const cw = Math.round(srcW * cropFraction);
    const ch = Math.round(srcH * cropFraction);
    const sx = Math.round((srcW - cw) / 2);
    const sy = Math.round((srcH - ch) / 2);
    const scale = Math.min(1, maxSide / Math.max(cw, ch));
    const dw = Math.max(1, Math.round(cw * scale));
    const dh = Math.max(1, Math.round(ch * scale));
    if (canvas.width !== dw) canvas.width = dw;
    if (canvas.height !== dh) canvas.height = dh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, sx, sy, cw, ch, 0, 0, dw, dh);
    return ctx.getImageData(0, 0, dw, dh);
  }

  function passGeometry(pass, srcW, srcH) {
    const longSide = Math.max(srcW, srcH);
    switch (pass) {
      case 'center': return { crop: longSide >= 1200 ? 0.5 : 0.65, max: 1280 };
      case 'adaptive': return { crop: 1, max: 1024 };
      case 'denoise': return { crop: 0.8, max: 1280 };
      default: return { crop: 1, max: 1280 };
    }
  }

  class QrScanner {
    constructor({ video, onResult, onHint }) {
      this.video = video;
      this.onResult = onResult;
      this.onHint = onHint || (() => {});
      this.canvas = document.createElement('canvas');
      this.stream = null;
      this.track = null;
      this.running = false;
      this.frame = 0;
      this.cameras = [];
      this.torchOn = false;
      this.focusTimer = null;
      this.hintTimer = null;
    }

    static isSupported() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    async start(deviceId) {
      await this.stop();
      getWorker(); // warm up wasm while the camera starts
      const preferred = deviceId || localStorage.getItem(CAMERA_KEY);
      const base = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
      let stream = null;
      if (preferred) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, deviceId: { exact: preferred } } });
        } catch (e) {
          localStorage.removeItem(CAMERA_KEY);
        }
      }
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, facingMode: { ideal: 'environment' } } });
      }
      this.stream = stream;
      this.track = stream.getVideoTracks()[0];
      this.torchOn = false;

      this.video.setAttribute('playsinline', '');
      this.video.muted = true;
      this.video.srcObject = stream;
      await this.video.play().catch(() => {});

      const caps = this.capabilities();
      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        this.cameras = devices.filter(d => d.kind === 'videoinput');
      } catch (e) {
        this.cameras = [];
      }

      this.running = true;
      this.frame = 0;
      this.loop();
      this.armHint();
      return this.features();
    }

    capabilities() {
      try {
        return (this.track && this.track.getCapabilities) ? this.track.getCapabilities() : {};
      } catch (e) {
        return {};
      }
    }

    features() {
      const caps = this.capabilities();
      const settings = this.track && this.track.getSettings ? this.track.getSettings() : {};
      return {
        torch: !!caps.torch,
        zoom: caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, value: settings.zoom || caps.zoom.min } : null,
        canFocus: !!(caps.focusMode && (caps.focusMode.includes('single-shot') || caps.focusMode.includes('manual'))) ||
          !!(navigator.mediaDevices.getSupportedConstraints && navigator.mediaDevices.getSupportedConstraints().pointsOfInterest),
        multipleCameras: this.cameras.length > 1,
        resolution: settings.width && settings.height ? `${settings.width}x${settings.height}` : null
      };
    }

    armHint() {
      clearTimeout(this.hintTimer);
      this.hintTimer = setTimeout(() => { if (this.running) this.onHint(); }, 7000);
    }

    async loop() {
      const native = await getNativeDetector();
      while (this.running) {
        const v = this.video;
        if (v.readyState < 2 || !v.videoWidth) {
          await new Promise(r => setTimeout(r, 100));
          continue;
        }
        const pass = PASSES[this.frame++ % PASSES.length];
        const g = passGeometry(pass, v.videoWidth, v.videoHeight);
        let imageData;
        try {
          imageData = grab(this.canvas, v, v.videoWidth, v.videoHeight, g.crop, g.max);
        } catch (e) {
          await new Promise(r => setTimeout(r, 100));
          continue;
        }

        const jobs = [decodeImageData(imageData, pass)];
        if (native) {
          jobs.push(native.detect(v).then(codes => (codes && codes[0] && codes[0].rawValue) || null).catch(() => null));
        }
        const text = await firstNonNull(jobs);
        if (!this.running) return;
        if (text) {
          this.running = false;
          clearTimeout(this.hintTimer);
          if (navigator.vibrate) navigator.vibrate(40);
          this.onResult(text);
          return;
        }
        await new Promise(r => setTimeout(r, 30));
      }
    }

    async stop() {
      this.running = false;
      clearTimeout(this.hintTimer);
      clearTimeout(this.focusTimer);
      if (this.stream) {
        this.stream.getTracks().forEach(t => t.stop());
      }
      this.stream = null;
      this.track = null;
      if (this.video) this.video.srcObject = null;
    }

    async setTorch(on) {
      if (!this.track) return false;
      try {
        await this.track.applyConstraints({ advanced: [{ torch: !!on }] });
        this.torchOn = !!on;
      } catch (e) {
        this.torchOn = false;
      }
      return this.torchOn;
    }

    async setZoom(value) {
      if (!this.track) return;
      await this.track.applyConstraints({ advanced: [{ zoom: Number(value) }] }).catch(() => {});
    }

    // x, y normalised 0..1 within the visible video
    async focusAt(x, y) {
      if (!this.track) return;
      const caps = this.capabilities();
      const advanced = [];
      const supported = navigator.mediaDevices.getSupportedConstraints ? navigator.mediaDevices.getSupportedConstraints() : {};
      if (supported.pointsOfInterest) advanced.push({ pointsOfInterest: [{ x, y }] });
      if (caps.focusMode && caps.focusMode.includes('single-shot')) advanced.push({ focusMode: 'single-shot' });
      if (!advanced.length) return;
      await this.track.applyConstraints({ advanced }).catch(() => {});
      clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(() => {
        if (this.track && caps.focusMode && caps.focusMode.includes('continuous')) {
          this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        }
      }, 2500);
    }

    async switchCamera() {
      if (this.cameras.length < 2) return this.features();
      const currentId = this.track && this.track.getSettings ? this.track.getSettings().deviceId : null;
      const idx = this.cameras.findIndex(c => c.deviceId === currentId);
      const next = this.cameras[(idx + 1) % this.cameras.length];
      localStorage.setItem(CAMERA_KEY, next.deviceId);
      return this.start(next.deviceId);
    }

    // Decode a still photo (camera capture or gallery). Photos are sharp and high-resolution,
    // so this is the fallback for the hardest labels.
    static async decodeFile(file) {
      let bitmap;
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) {
        bitmap = await createImageBitmap(file);
      }
      const native = await getNativeDetector();
      if (native) {
        try {
          const codes = await native.detect(bitmap);
          if (codes && codes[0] && codes[0].rawValue) return codes[0].rawValue;
        } catch (e) { /* fall through */ }
      }
      const canvas = document.createElement('canvas');
      const attempts = [
        ['full', 1, 2000], ['stretch', 1, 2000], ['adaptive', 1, 1400],
        ['full', 0.6, 2000], ['adaptive', 0.6, 1400], ['full', 1, 1000], ['denoise', 1, 1600]
      ];
      for (const [pass, crop, max] of attempts) {
        const data = grab(canvas, bitmap, bitmap.width, bitmap.height, crop, max);
        const text = await decodeImageData(data, pass);
        if (text) return text;
      }
      return null;
    }
  }

  // Resolve with the first non-null result, or null once all have settled.
  function firstNonNull(promises) {
    return new Promise((resolve) => {
      let left = promises.length;
      promises.forEach(p => p.then((v) => {
        if (v) resolve(v);
        else if (--left === 0) resolve(null);
      }, () => { if (--left === 0) resolve(null); }));
    });
  }

  window.QrScanner = QrScanner;
})();
