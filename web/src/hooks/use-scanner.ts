import { useCallback, useEffect, useRef, useState } from 'react'
import { QrScanner, type ScannerFeatures } from '@/lib/scanner/qr-scanner'

/** React wrapper around QrScanner (camera + decode loop). */
export function useScanner(onResult: (text: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScanner | null>(null)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  const [active, setActive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [features, setFeatures] = useState<ScannerFeatures | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [zoom, setZoomState] = useState<number | null>(null)
  const [hint, setHint] = useState(false)
  const [detected, setDetected] = useState(false)

  const getScanner = useCallback(() => {
    if (!scannerRef.current && videoRef.current) {
      scannerRef.current = new QrScanner(
        videoRef.current,
        (text) => {
          setDetected(true)
          // brief green flash, then hand the code over
          setTimeout(() => {
            void scannerRef.current?.stop()
            setActive(false)
            setDetected(false)
            onResultRef.current(text)
          }, 250)
        },
        () => setHint(true),
      )
    }
    return scannerRef.current
  }, [])

  const applyFeatures = (f: ScannerFeatures) => {
    setFeatures(f)
    setTorchOn(false)
    setZoomState(f.zoom ? f.zoom.value : null)
  }

  const start = useCallback(async () => {
    const s = getScanner()
    if (!s) return
    setStarting(true)
    setHint(false)
    setDetected(false)
    setActive(true)
    try {
      applyFeatures(await s.start())
    } catch (e) {
      setActive(false)
      throw e
    } finally {
      setStarting(false)
    }
  }, [getScanner])

  const stop = useCallback(async () => {
    await scannerRef.current?.stop()
    setActive(false)
    setHint(false)
    setDetected(false)
  }, [])

  const toggleTorch = useCallback(async () => {
    const s = scannerRef.current
    if (!s) return
    setTorchOn(await s.setTorch(!torchOn))
  }, [torchOn])

  const setZoom = useCallback((value: number) => {
    setZoomState(value)
    void scannerRef.current?.setZoom(value)
  }, [])

  const switchCamera = useCallback(async () => {
    const s = scannerRef.current
    if (s) applyFeatures(await s.switchCamera())
  }, [])

  const focusAt = useCallback((x: number, y: number) => {
    void scannerRef.current?.focusAt(x, y)
  }, [])

  // Stop the camera when the app goes to the background, and on unmount
  useEffect(() => {
    const onVis = () => { if (document.hidden && scannerRef.current?.running) void stop() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      void scannerRef.current?.stop()
    }
  }, [stop])

  return { videoRef, active, starting, features, torchOn, zoom, hint, detected, start, stop, toggleTorch, setZoom, switchCamera, focusAt }
}
