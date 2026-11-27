import type { MouseEvent } from 'react'
import { useState } from 'react'
import { CameraIcon, FlashlightIcon, ScanLineIcon, SwitchCameraIcon, XIcon, ZoomInIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import type { useScanner } from '@/hooks/use-scanner'

interface Props {
  scanner: ReturnType<typeof useScanner>
  canStart: boolean
  onStart: () => void
}

/** Camera viewport: live video, framing overlay (guide only, the whole frame is decoded) and controls. */
export function CameraCard({ scanner, canStart, onStart }: Props) {
  const { videoRef, active, starting, features, torchOn, zoom, hint, detected } = scanner
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number; key: number } | null>(null)

  const onTap = (e: MouseEvent<HTMLVideoElement>) => {
    const video = videoRef.current
    if (!video || !active) return
    const rect = video.getBoundingClientRect()
    setFocusPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top, key: Date.now() })
    // map the tap to video coordinates (object-fit: cover crops the edges)
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return
    const scale = Math.max(rect.width / vw, rect.height / vh)
    const dispW = vw * scale
    const dispH = vh * scale
    const x = (e.clientX - rect.left + (dispW - rect.width) / 2) / dispW
    const y = (e.clientY - rect.top + (dispH - rect.height) / 2) / dispH
    scanner.focusAt(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)))
  }

  return (
    <Card className="relative aspect-[4/5] max-h-[52dvh] w-full gap-0 overflow-hidden rounded-2xl bg-slate-950 py-0 text-white ring-0 sm:aspect-[3/4] sm:max-h-[60dvh]">
      <video ref={videoRef} playsInline muted onClick={onTap} className="absolute inset-0 size-full object-cover" />

      {active && (
        <>
          {/* framing guide */}
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute top-[46%] left-1/2 aspect-square w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-2xl transition-shadow',
              detected ? 'shadow-[0_0_0_9999px_rgba(4,120,87,0.4)]' : 'shadow-[0_0_0_9999px_rgba(2,6,23,0.4)]',
            )}
          >
            {['top-0 left-0 border-t-4 border-l-4 rounded-tl-2xl', 'top-0 right-0 border-t-4 border-r-4 rounded-tr-2xl',
              'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl', 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl'].map((c) => (
              <span key={c} className={cn('absolute size-8', c, detected ? 'border-emerald-400' : 'border-white')} />
            ))}
            {!detected && (
              <span className="absolute inset-x-[8%] h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent [animation:scan-sweep_2.2s_ease-in-out_infinite]" />
            )}
          </div>

          {focusPoint && (
            <span
              key={focusPoint.key}
              aria-hidden
              className="pointer-events-none absolute -mt-9 -ml-9 size-[72px] rounded-full border-2 border-yellow-300 opacity-0 [animation:focus-ping_0.9s_ease-out]"
              style={{ left: focusPoint.x, top: focusPoint.y }}
            />
          )}

          <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-center">
            <span role="status" className="inline-flex items-center gap-2 rounded-full bg-slate-950/75 px-3 py-1.5 text-sm font-medium backdrop-blur">
              {starting ? <Spinner className="size-3.5" /> : <span className="size-2 animate-pulse rounded-full bg-emerald-400" />}
              {starting ? 'Starting camera…' : detected ? 'Code found – looking up…' : 'Point at a QR code'}
            </span>
          </div>

          {hint && !detected && (
            <div className="pointer-events-none absolute inset-x-3 bottom-[4.5rem] flex justify-center">
              <span className="rounded-xl bg-amber-700/90 px-3 py-2 text-center text-sm leading-snug">
                Hard to read? Move closer or further, tap to focus, turn on the light, or use “Scan from photo”.
              </span>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-slate-950/80 to-transparent p-2">
            {features?.torch && (
              <Toggle
                aria-label="Toggle light"
                pressed={torchOn}
                onPressedChange={() => void scanner.toggleTorch()}
                className="size-11 rounded-full bg-white/15 text-white hover:bg-white/25 hover:text-white data-[state=on]:bg-yellow-300 data-[state=on]:text-slate-900"
              >
                <FlashlightIcon className="size-5" />
              </Toggle>
            )}
            {features?.zoom && zoom !== null ? (
              <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
                <ZoomInIcon className="size-5 shrink-0" aria-hidden />
                <Slider
                  aria-label="Zoom"
                  min={features.zoom.min}
                  max={features.zoom.max}
                  step={features.zoom.step}
                  value={[zoom]}
                  onValueChange={([v]) => scanner.setZoom(v)}
                  className="flex-1 py-3"
                />
                <span className="w-9 text-xs font-semibold tabular-nums">{zoom.toFixed(1)}×</span>
              </div>
            ) : (
              <span className="flex-1" />
            )}
            {features?.multipleCameras && (
              <Button size="icon-touch" variant="ghost" aria-label="Switch camera" onClick={() => void scanner.switchCamera()}
                className="rounded-full bg-white/15 text-white hover:bg-white/25 hover:text-white">
                <SwitchCameraIcon className="size-5" />
              </Button>
            )}
            <Button size="icon-touch" variant="ghost" aria-label="Stop camera" onClick={() => void scanner.stop()}
              className="rounded-full bg-white/15 text-white hover:bg-white/25 hover:text-white">
              <XIcon className="size-5" />
            </Button>
          </div>
        </>
      )}

      {!active && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_40%,#1e293b,#020617_70%)] p-5 text-center">
          <CameraIcon className="size-9 text-slate-400" aria-hidden />
          <p className="max-w-64 text-sm text-slate-300">
            {canStart ? 'Hold the label in view. Bent, small or angled codes are fine.' : 'Choose your location first, then start the camera.'}
          </p>
          <Button size="touch-lg" disabled={!canStart} onClick={onStart} className="bg-success text-success-foreground hover:bg-success/90">
            <ScanLineIcon /> Start scanning
          </Button>
        </div>
      )}
    </Card>
  )
}
