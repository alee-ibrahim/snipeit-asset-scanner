import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CameraIcon, CircleCheckIcon, PackageIcon, RefreshCwIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError, type Asset, type Location, type ManualAsset } from '@/lib/api'
import { compressImage } from '@/lib/helpers'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  token: string
  location: Location | null
  userName: string
  onSaved: (record: ManualAsset) => void
}

type Lookup = { state: 'idle' } | { state: 'busy' } | { state: 'found'; asset: Asset } | { state: 'missing' } | { state: 'error' }

/** "No QR? Add with photo": asset number + description + photo (+ notes). */
export function NoQrDrawer({ open, onOpenChange, token, location, userName, onSaved }: Props) {
  const [number, setNumber] = useState('')
  const [desc, setDesc] = useState('')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<{ dataUrl: string; label: string } | null>(null)
  const [processing, setProcessing] = useState(false)
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' })
  const [error, setError] = useState<{ msg: string; field?: 'number' | 'desc' | 'photo' } | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    setNumber(''); setDesc(''); setNotes(''); setPhoto(null); setLookup({ state: 'idle' }); setError(null)
  }, [open])

  // Debounced Snipe-IT lookup as the number is typed
  useEffect(() => {
    const q = number.trim()
    if (q.length < 2) { setLookup({ state: 'idle' }); return }
    setLookup({ state: 'busy' })
    const id = ++seq.current
    const t = setTimeout(async () => {
      try {
        const asset = await api.searchAsset(token, q)
        if (id !== seq.current) return
        setLookup({ state: 'found', asset })
        setDesc((d) => d.trim() ? d : [asset.model?.name, asset.name].filter(Boolean).join(' – '))
      } catch (e) {
        if (id !== seq.current) return
        setLookup(e instanceof ApiError && e.status === 404 ? { state: 'missing' } : { state: 'error' })
      }
    }, 600)
    return () => clearTimeout(t)
  }, [number, token])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setProcessing(true)
    try {
      const r = await compressImage(file)
      setPhoto({ dataUrl: r.dataUrl, label: `${r.width}×${r.height} · ${Math.round(r.bytes / 1024)} KB` })
      if (error?.field === 'photo') setError(null)
    } catch {
      toast.error('Could not read that photo. Try again.')
    } finally {
      setProcessing(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!number.trim()) return setError({ msg: 'Enter the asset number.', field: 'number' })
    if (!desc.trim()) return setError({ msg: 'Add a short description.', field: 'desc' })
    if (!photo) return setError({ msg: 'Take a photo of the asset.', field: 'photo' })
    if (!location) return setError({ msg: 'Choose your location first.' })
    setError(null)
    setSaving(true)
    try {
      const record = await api.saveManualAsset(token, {
        asset_number: number.trim(),
        description: desc.trim(),
        notes: notes.trim(),
        photo: photo.dataUrl,
        location_id: location.id,
        location_name: location.name,
        user_name: userName,
      })
      onOpenChange(false)
      onSaved(record)
    } catch (err) {
      setError({ msg: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className="max-h-[92dvh]">
        <form onSubmit={submit} noValidate className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col">
          <DrawerHeader className="pb-1">
            <DrawerTitle>Add asset without QR</DrawerTitle>
            <DrawerDescription>{location ? `${location.name} · ${userName}` : 'Choose a location first'}</DrawerDescription>
          </DrawerHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
            <FieldGroup className="gap-3">
              <Field data-invalid={error?.field === 'number' || undefined}>
                <FieldLabel htmlFor="noqr-number">Asset number</FieldLabel>
                <Input id="noqr-number" className="h-11" autoComplete="off" autoCapitalize="characters"
                  placeholder="Asset tag, SAP # or number on the item" value={number}
                  aria-invalid={error?.field === 'number' || undefined}
                  onChange={(e) => setNumber(e.target.value)} />
                {lookup.state !== 'idle' && (
                  <Alert
                    aria-live="polite"
                    className={cn('py-2 text-sm',
                      lookup.state === 'found' && 'border-success/40 bg-success/10 text-success',
                      lookup.state === 'missing' && 'border-warning/40 bg-warning/10 text-warning')}
                  >
                    {lookup.state === 'busy' && <Spinner />}
                    {lookup.state === 'found' && <CircleCheckIcon />}
                    {lookup.state === 'missing' && <PackageIcon />}
                    <AlertDescription className="text-current">
                      {lookup.state === 'busy' && 'Checking Snipe-IT…'}
                      {lookup.state === 'error' && 'Could not check Snipe-IT right now. You can still save.'}
                      {lookup.state === 'missing' && <span>Not in Snipe-IT. It will be saved as an <strong className="text-foreground">unregistered asset</strong> for admin review.</span>}
                      {lookup.state === 'found' && (
                        <span>
                          Found: <strong className="text-foreground">{lookup.asset.name || lookup.asset.model?.name || lookup.asset.asset_tag}</strong>{' '}
                          ({lookup.asset.asset_tag}), recorded at {lookup.asset.location?.name || 'no location'}. The audit and photo will be added to it.
                        </span>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </Field>

              <Field data-invalid={error?.field === 'desc' || undefined}>
                <FieldLabel htmlFor="noqr-desc">Description</FieldLabel>
                <Input id="noqr-desc" className="h-11" autoComplete="off" placeholder={'e.g. Dell monitor 24", black office chair'}
                  value={desc} aria-invalid={error?.field === 'desc' || undefined} onChange={(e) => setDesc(e.target.value)} />
              </Field>

              <Field data-invalid={error?.field === 'photo' || undefined}>
                <FieldLabel>Photo of the asset</FieldLabel>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
                {photo ? (
                  <div className="overflow-hidden rounded-lg border">
                    <img src={photo.dataUrl} alt="Photo of the asset" className="max-h-44 w-full bg-slate-950 object-contain" />
                    <div className="flex items-center justify-between gap-2 px-3 py-1">
                      <FieldDescription className="text-xs">{photo.label}</FieldDescription>
                      <Button type="button" variant="ghost" size="touch" onClick={() => fileRef.current?.click()}>
                        <RefreshCwIcon /> Retake
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="outline" disabled={processing} onClick={() => fileRef.current?.click()}
                    className={cn('h-28 w-full flex-col gap-1 border-2 border-dashed text-muted-foreground', error?.field === 'photo' && 'border-destructive')}>
                    {processing ? <Spinner className="size-6" /> : <CameraIcon className="size-6" />}
                    {processing ? 'Processing photo…' : 'Tap to take a photo'}
                  </Button>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="noqr-notes">Notes <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
                <Textarea id="noqr-notes" rows={2} placeholder="Condition, where exactly, etc." value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>

              {error && (
                <Alert variant="destructive" role="alert" className="py-2">
                  <AlertDescription>{error.msg}</AlertDescription>
                </Alert>
              )}
            </FieldGroup>
          </div>

          <DrawerFooter className="flex-row border-t pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <DrawerClose asChild>
              <Button type="button" variant="outline" size="touch" className="flex-1">Cancel</Button>
            </DrawerClose>
            <Button type="submit" size="touch" disabled={saving} className="flex-1 bg-success text-success-foreground hover:bg-success/90">
              {saving && <Spinner />} Save
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
