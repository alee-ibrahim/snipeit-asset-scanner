import type { MouseEvent } from 'react'
import { FlashlightIcon, SwitchCameraIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Toggle } from '@/components/ui/toggle'
import type { useScanner } from '@/hooks/use-scanner'

interface Props {
  scanner: ReturnType<typeof useScanner>
  canStart: boolean
  onStart: () => void
}

/** Camera viewfinder: a plain video element inside a Card. The whole frame is decoded. */
export function CameraCard({ scanner, canStart, onStart }: Props) {
  const { videoRef, active, starting, features, torchOn, zoom, hint, detected } = scanner

  // Tap to focus: map the tap to video coordinates (object-fit: cover crops the edges)
  const onTap = (e: MouseEvent<HTMLVideoElement>) => {
    const video = videoRef.current
    if (!video || !active || !video.videoWidth) return
    const rect = video.getBoundingClientRect()
    const scale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight)
    const dispW = video.videoWidth * scale
    const dispH = video.videoHeight * scale
    const x = (e.clientX - rect.left + (dispW - rect.width) / 2) / dispW
    const y = (e.clientY - rect.top + (dispH - rect.height) / 2) / dispH
    scanner.focusAt(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)))
  }

  const status = !active
    ? canStart ? 'Camera is off.' : 'Choose your location first.'
    : starting ? 'Starting camera…' : detected ? 'Code found, looking up…' : 'Point the camera at a QR code. Tap to focus.'

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Scan</CardTitle>
        <CardDescription role="status">{status}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <video
          ref={videoRef}
          playsInline
          muted
          onClick={onTap}
          className={active ? 'aspect-square w-full rounded-md bg-muted object-cover' : 'hidden'}
        />
        {active && hint && !detected && (
          <Alert>
            <AlertDescription>Hard to read? Move closer or further away, tap to focus, turn on the light, or use “Scan from photo”.</AlertDescription>
          </Alert>
        )}
        {active && features?.zoom && zoom !== null && (
          <div className="flex items-center gap-3">
            <Label htmlFor="zoom">Zoom</Label>
            <Slider id="zoom" min={features.zoom.min} max={features.zoom.max} step={features.zoom.step} value={[zoom]} onValueChange={([v]) => scanner.setZoom(v)} />
            <span className="w-10 text-sm text-muted-foreground">{zoom.toFixed(1)}×</span>
          </div>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        {active ? (
          <>
            <Button variant="outline" className="flex-1" onClick={() => void scanner.stop()}>Stop camera</Button>
            {features?.torch && (
              <Toggle variant="outline" aria-label="Toggle light" pressed={torchOn} onPressedChange={() => void scanner.toggleTorch()}>
                <FlashlightIcon />
              </Toggle>
            )}
            {features?.multipleCameras && (
              <Button variant="outline" size="icon" aria-label="Switch camera" onClick={() => void scanner.switchCamera()}>
                <SwitchCameraIcon />
              </Button>
            )}
          </>
        ) : (
          <Button className="w-full" disabled={!canStart} onClick={onStart}>Start scanning</Button>
        )}
      </CardFooter>
    </Card>
  )
}
