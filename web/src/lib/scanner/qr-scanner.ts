/*
 * QrScanner: camera QR scanning tuned for real-world asset labels.
 *
 * Every frame (the whole frame, no tiny scan box):
 *   1. Native BarcodeDetector (Android Chrome etc.) when it supports QR. Fast, ML based.
 *   2. zxing-wasm in a Web Worker, rotating through passes:
 *        full     - whole frame, LocalAverage binarizer, tryHarder/rotate/invert/downscale
 *        center   - centre crop at native resolution (small / distant codes)
 *        stretch  - grayscale + contrast stretch, GlobalHistogram (faded, low contrast)
 *        adaptive - adaptive threshold (shadows, glare, curved/bent labels)
 *        denoise  - wider crop with denoise (noisy low-light frames)
 * Camera: ideal 1920x1080, continuous autofocus, torch, zoom, tap-to-focus, camera switch.
 */
import type { DecodePass, DecodeRequest, DecodeResponse } from './decoder.worker'

const PASSES: DecodePass[] = ['full', 'center', 'stretch', 'adaptive', 'full', 'denoise']
const CAMERA_KEY = 'scanner_camera_id'

export interface ScannerFeatures {
  torch: boolean
  zoom: { min: number; max: number; step: number; value: number } | null
  multipleCameras: boolean
  resolution: string | null
}

// Not yet in TypeScript's DOM lib
interface BarcodeDetectorLike { detect(source: CanvasImageSource | ImageBitmap): Promise<Array<{ rawValue: string }>> }
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike
  getSupportedFormats(): Promise<string[]>
}
type Caps = MediaTrackCapabilities & {
  torch?: boolean
  zoom?: { min: number; max: number; step?: number }
  focusMode?: string[]
}
type LooseConstraints = MediaTrackConstraints & { advanced?: Array<Record<string, unknown>> }

let worker: Worker | null = null
let nextJobId = 1
const pending = new Map<number, (msg: DecodeResponse) => void>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<DecodeResponse>) => {
    const job = pending.get(e.data.id)
    if (job) {
      pending.delete(e.data.id)
      job(e.data)
    }
  }
  worker.onerror = (e) => console.error('Decoder worker error', e.message || e)
  return worker
}

function decodeImageData(imageData: ImageData, pass: DecodePass): Promise<string | null> {
  return new Promise((resolve) => {
    const id = nextJobId++
    pending.set(id, (msg) => resolve(msg.text || null))
    const req: DecodeRequest = { id, width: imageData.width, height: imageData.height, buffer: imageData.data.buffer as ArrayBuffer, pass }
    getWorker().postMessage(req, [req.buffer])
  })
}

let nativeDetector: BarcodeDetectorLike | null | undefined
async function getNativeDetector(): Promise<BarcodeDetectorLike | null> {
  if (nativeDetector !== undefined) return nativeDetector
  nativeDetector = null
  try {
    const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    if (BD) {
      const supported = await BD.getSupportedFormats()
      if (supported.includes('qr_code')) {
        nativeDetector = new BD({ formats: ['qr_code', 'data_matrix', 'code_128'].filter((f) => supported.includes(f)) })
      }
    }
  } catch {
    nativeDetector = null
  }
  return nativeDetector
}

// Draw a centred region of a source to a canvas, scaled so the long side <= maxSide.
function grab(canvas: HTMLCanvasElement, source: CanvasImageSource, srcW: number, srcH: number, crop: number, maxSide: number) {
  const cw = Math.round(srcW * crop)
  const ch = Math.round(srcH * crop)
  const sx = Math.round((srcW - cw) / 2)
  const sy = Math.round((srcH - ch) / 2)
  const scale = Math.min(1, maxSide / Math.max(cw, ch))
  const dw = Math.max(1, Math.round(cw * scale))
  const dh = Math.max(1, Math.round(ch * scale))
  if (canvas.width !== dw) canvas.width = dw
  if (canvas.height !== dh) canvas.height = dh
  const c = canvas.getContext('2d', { willReadFrequently: true })!
  c.drawImage(source, sx, sy, cw, ch, 0, 0, dw, dh)
  return c.getImageData(0, 0, dw, dh)
}

function passGeometry(pass: DecodePass, srcW: number, srcH: number) {
  const longSide = Math.max(srcW, srcH)
  switch (pass) {
    case 'center': return { crop: longSide >= 1200 ? 0.5 : 0.65, max: 1280 }
    case 'adaptive': return { crop: 1, max: 1024 }
    case 'denoise': return { crop: 0.8, max: 1280 }
    default: return { crop: 1, max: 1280 }
  }
}

// Resolve with the first non-null result, or null once all have settled.
function firstNonNull(promises: Promise<string | null>[]): Promise<string | null> {
  return new Promise((resolve) => {
    let left = promises.length
    promises.forEach((p) => p.then(
      (v) => { if (v) resolve(v); else if (--left === 0) resolve(null) },
      () => { if (--left === 0) resolve(null) },
    ))
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class QrScanner {
  private canvas = document.createElement('canvas')
  private stream: MediaStream | null = null
  private track: MediaStreamTrack | null = null
  private frame = 0
  private cameras: MediaDeviceInfo[] = []
  private focusTimer: ReturnType<typeof setTimeout> | undefined
  private hintTimer: ReturnType<typeof setTimeout> | undefined
  running = false

  private video: HTMLVideoElement
  private onResult: (text: string) => void
  private onHint: () => void

  constructor(video: HTMLVideoElement, onResult: (text: string) => void, onHint: () => void = () => {}) {
    this.video = video
    this.onResult = onResult
    this.onHint = onHint
  }

  static isSupported() {
    return !!navigator.mediaDevices?.getUserMedia
  }

  static warmUp() {
    getWorker()
  }

  async start(deviceId?: string): Promise<ScannerFeatures> {
    await this.stop()
    getWorker() // load wasm while the camera starts
    const preferred = deviceId || localStorage.getItem(CAMERA_KEY)
    const base: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
    let stream: MediaStream | null = null
    if (preferred) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, deviceId: { exact: preferred } } })
      } catch {
        localStorage.removeItem(CAMERA_KEY)
      }
    }
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, facingMode: { ideal: 'environment' } } })
    }
    this.stream = stream
    this.track = stream.getVideoTracks()[0]

    this.video.setAttribute('playsinline', '')
    this.video.muted = true
    this.video.srcObject = stream
    await this.video.play().catch(() => {})

    const caps = this.capabilities()
    if (caps.focusMode?.includes('continuous')) await this.apply({ focusMode: 'continuous' })

    try {
      this.cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
    } catch {
      this.cameras = []
    }

    this.running = true
    this.frame = 0
    void this.loop()
    clearTimeout(this.hintTimer)
    this.hintTimer = setTimeout(() => { if (this.running) this.onHint() }, 7000)
    return this.features()
  }

  private capabilities(): Caps {
    try {
      return (this.track?.getCapabilities?.() ?? {}) as Caps
    } catch {
      return {} as Caps
    }
  }

  private async apply(constraint: Record<string, unknown> | Array<Record<string, unknown>>) {
    if (!this.track) return false
    try {
      await this.track.applyConstraints({ advanced: Array.isArray(constraint) ? constraint : [constraint] } as LooseConstraints)
      return true
    } catch {
      return false
    }
  }

  features(): ScannerFeatures {
    const caps = this.capabilities()
    const settings = (this.track?.getSettings?.() ?? {}) as MediaTrackSettings & { zoom?: number }
    return {
      torch: !!caps.torch,
      zoom: caps.zoom && caps.zoom.max > caps.zoom.min
        ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, 8), step: caps.zoom.step || 0.1, value: settings.zoom ?? caps.zoom.min }
        : null,
      multipleCameras: this.cameras.length > 1,
      resolution: settings.width && settings.height ? `${settings.width}x${settings.height}` : null,
    }
  }

  private async loop() {
    const native = await getNativeDetector()
    while (this.running) {
      const v = this.video
      if (v.readyState < 2 || !v.videoWidth) { await sleep(100); continue }
      const pass = PASSES[this.frame++ % PASSES.length]
      const g = passGeometry(pass, v.videoWidth, v.videoHeight)
      let imageData: ImageData
      try {
        imageData = grab(this.canvas, v, v.videoWidth, v.videoHeight, g.crop, g.max)
      } catch {
        await sleep(100)
        continue
      }
      const jobs = [decodeImageData(imageData, pass)]
      if (native) jobs.push(native.detect(v).then((codes) => codes?.[0]?.rawValue || null).catch(() => null))
      const text = await firstNonNull(jobs)
      if (!this.running) return
      if (text) {
        this.running = false
        clearTimeout(this.hintTimer)
        navigator.vibrate?.(40)
        this.onResult(text)
        return
      }
      await sleep(30)
    }
  }

  async stop() {
    this.running = false
    clearTimeout(this.hintTimer)
    clearTimeout(this.focusTimer)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.track = null
    this.video.srcObject = null
  }

  async setTorch(on: boolean) {
    return (await this.apply({ torch: on })) ? on : false
  }

  async setZoom(value: number) {
    await this.apply({ zoom: value })
  }

  // x, y normalised 0..1 within the video frame
  async focusAt(x: number, y: number) {
    const caps = this.capabilities()
    const supported = navigator.mediaDevices.getSupportedConstraints?.() as Record<string, boolean> | undefined
    const advanced: Array<Record<string, unknown>> = []
    if (supported?.pointsOfInterest) advanced.push({ pointsOfInterest: [{ x, y }] })
    if (caps.focusMode?.includes('single-shot')) advanced.push({ focusMode: 'single-shot' })
    if (!advanced.length) return
    await this.apply(advanced)
    clearTimeout(this.focusTimer)
    this.focusTimer = setTimeout(() => {
      if (caps.focusMode?.includes('continuous')) void this.apply({ focusMode: 'continuous' })
    }, 2500)
  }

  async switchCamera(): Promise<ScannerFeatures> {
    if (this.cameras.length < 2) return this.features()
    const currentId = this.track?.getSettings?.().deviceId
    const idx = this.cameras.findIndex((c) => c.deviceId === currentId)
    const next = this.cameras[(idx + 1) % this.cameras.length]
    localStorage.setItem(CAMERA_KEY, next.deviceId)
    return this.start(next.deviceId)
  }

  // Decode a still photo (camera capture or gallery). Sharp, high-resolution stills are the
  // fallback for the hardest labels.
  static async decodeFile(file: Blob): Promise<string | null> {
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      bitmap = await createImageBitmap(file)
    }
    const native = await getNativeDetector()
    if (native) {
      try {
        const codes = await native.detect(bitmap)
        if (codes?.[0]?.rawValue) return codes[0].rawValue
      } catch { /* fall through */ }
    }
    const canvas = document.createElement('canvas')
    const attempts: Array<[DecodePass, number, number]> = [
      ['full', 1, 2000], ['stretch', 1, 2000], ['adaptive', 1, 1400],
      ['full', 0.6, 2000], ['adaptive', 0.6, 1400], ['full', 1, 1000], ['denoise', 1, 1600],
    ]
    for (const [pass, crop, max] of attempts) {
      const text = await decodeImageData(grab(canvas, bitmap, bitmap.width, bitmap.height, crop, max), pass)
      if (text) return text
    }
    return null
  }
}
