import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError, type Asset, type Location, type ManualAsset } from '@/lib/api'
import { compressImage } from '@/lib/helpers'

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
  const [error, setError] = useState<string | null>(null)
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
      setPhoto({ dataUrl: r.dataUrl, label: `${r.width}×${r.height}, ${Math.round(r.bytes / 1024)} KB` })
    } catch {
      toast.error('Could not read that photo. Try again.')
    } finally {
      setProcessing(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!number.trim()) return setError('Enter the asset number.')
    if (!desc.trim()) return setError('Add a short description.')
    if (!photo) return setError('Take a photo of the asset.')
    if (!location) return setError('Choose your location first.')
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
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent>
        <form onSubmit={submit} noValidate className="mx-auto flex w-full max-w-lg flex-col overflow-y-auto">
          <DrawerHeader>
            <DrawerTitle>Add asset without QR</DrawerTitle>
            <DrawerDescription>{location ? `${location.name}, ${userName}` : 'Choose a location first'}</DrawerDescription>
          </DrawerHeader>

          <div className="grid gap-4 px-4">
            <div className="grid gap-2">
              <Label htmlFor="noqr-number">Asset number</Label>
              <Input id="noqr-number" autoComplete="off" autoCapitalize="characters" placeholder="Asset tag, SAP # or number on the item"
                value={number} onChange={(e) => setNumber(e.target.value)} />
              {lookup.state === 'busy' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Checking Snipe-IT…</p>}
              {lookup.state === 'error' && <p className="text-sm text-muted-foreground">Could not check Snipe-IT right now. You can still save.</p>}
              {lookup.state === 'found' && (
                <Alert>
                  <AlertTitle>Found in Snipe-IT</AlertTitle>
                  <AlertDescription>
                    {lookup.asset.name || lookup.asset.model?.name || lookup.asset.asset_tag} ({lookup.asset.asset_tag}), recorded at {lookup.asset.location?.name || 'no location'}. The audit and photo will be added to it.
                  </AlertDescription>
                </Alert>
              )}
              {lookup.state === 'missing' && (
                <Alert>
                  <AlertTitle>Not in Snipe-IT</AlertTitle>
                  <AlertDescription>It will be saved as an unregistered asset for admin review.</AlertDescription>
                </Alert>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="noqr-desc">Description</Label>
              <Input id="noqr-desc" autoComplete="off" placeholder={'e.g. Dell monitor 24", black office chair'} value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="noqr-photo">Photo of the asset</Label>
              <input ref={fileRef} id="noqr-photo" type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
              {photo && <img src={photo.dataUrl} alt="Photo of the asset" className="max-h-48 w-full rounded-md border object-contain" />}
              <Button type="button" variant="outline" disabled={processing} onClick={() => fileRef.current?.click()}>
                {processing && <Spinner />} {photo ? 'Retake photo' : 'Take photo'}
              </Button>
              {photo && <p className="text-sm text-muted-foreground">{photo.label}</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="noqr-notes">Notes (optional)</Label>
              <Textarea id="noqr-notes" placeholder="Condition, where exactly, etc." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DrawerFooter>
            <Button type="submit" disabled={saving}>{saving && <Spinner />} Save</Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
