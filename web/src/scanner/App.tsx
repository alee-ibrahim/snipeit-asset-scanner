import { useCallback, useEffect, useRef, useState } from 'react'
import { DownloadIcon, ImageIcon, KeyboardIcon, LogOutIcon, PlusIcon, ShieldIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useConfirm } from '@/hooks/use-confirm'
import { useScanner } from '@/hooks/use-scanner'
import { api, downloadBlob, type Asset, type Location, type SnipeUser } from '@/lib/api'
import { displayName, extractSap, getStoredToken, initials, removeStoredToken, setStoredToken } from '@/lib/helpers'
import { QrScanner } from '@/lib/scanner/qr-scanner'
import { CameraCard } from './components/camera-card'
import { LocationDrawer } from './components/location-drawer'
import { ManualEntryDrawer } from './components/manual-entry-drawer'
import { NoQrDrawer } from './components/noqr-drawer'
import { ResultCard } from './components/result-card'
import { SuccessCard, type SuccessInfo } from './components/success-card'

type Panel = 'scan' | 'result' | 'success'

export default function ScannerApp() {
  const [token, setToken] = useState(() => getStoredToken('snipeit_token') || '')
  const [user, setUser] = useState<SnipeUser | null>(null)
  const [connecting, setConnecting] = useState(!!token)
  const [tokenInput, setTokenInput] = useState('')
  const [setupError, setSetupError] = useState<string | null>(null)

  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState<number | null>(null)
  const [locOpen, setLocOpen] = useState(false)

  const [panel, setPanel] = useState<Panel>('scan')
  const [asset, setAsset] = useState<Asset | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<SuccessInfo | null>(null)
  const [auditCount, setAuditCount] = useState(0)
  const [manualOpen, setManualOpen] = useState(false)
  const [noqrOpen, setNoqrOpen] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)
  const { confirm, dialog } = useConfirm()

  const location = locations.find((l) => l.id === locationId) ?? null
  const userName = displayName(user)
  const hasUnlogged = panel === 'result' && !!asset

  // ---- connect ----
  const connect = useCallback(async (t: string, fromCache = false) => {
    setConnecting(true)
    setSetupError(null)
    try {
      const u = await api.user(t)
      setUser(u)
      setToken(t)
      setStoredToken('snipeit_token', t)
      const locs = await api.locations(t).catch(() => { toast.error('Could not load locations'); return [] as Location[] })
      locs.sort((a, b) => a.name.localeCompare(b.name))
      setLocations(locs)
      const saved = Number(sessionStorage.getItem('scanner_location'))
      if (saved && locs.some((l) => l.id === saved)) setLocationId(saved)
      api.userAudits(displayName(u)).then((a) => setAuditCount(a.length)).catch(() => {})
    } catch {
      setSetupError(fromCache ? 'Saved token no longer works. Please enter it again.' : 'Could not connect. Check your API token.')
      removeStoredToken('snipeit_token')
      setToken('')
      setUser(null)
    } finally {
      setConnecting(false)
    }
  }, [])

  useEffect(() => {
    if (token) void connect(token, true)
    QrScanner.warmUp()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (hasUnlogged) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [hasUnlogged])

  const selectLocation = (id: number) => {
    setLocationId(id)
    sessionStorage.setItem('scanner_location', String(id))
    const name = locations.find((l) => l.id === id)?.name
    if (name) toast(`Location set: ${name}`)
  }

  const requireLocation = () => {
    if (location) return true
    toast('Choose your current location first')
    setLocOpen(true)
    return false
  }

  const guardUnlogged = async () => {
    if (!hasUnlogged) return true
    const ok = await confirm({ title: 'Discard this asset?', description: 'The asset on screen has not been logged yet. Discard it and continue?', confirmLabel: 'Discard' })
    if (ok) { setAsset(null); setNotes(''); setPanel('scan') }
    return ok
  }

  // ---- scanning ----
  const showAsset = (a: Asset) => {
    setAsset(a)
    setPanel('result')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    const match = a.location?.id === locationId
    navigator.vibrate?.(match ? 30 : [60, 60, 60])
  }

  const startCamera = useRef<() => Promise<void>>(async () => {})

  const searchAndShow = async (query: string) => {
    const a = await api.searchAsset(token, query)
    showAsset(a)
  }

  // Snipe-IT label QR = https://snipe.example/hardware/123; plain text codes are looked up as tag / SAP #.
  const processScan = async (text: string) => {
    const raw = text.trim()
    const m = raw.match(/\/hardware\/(\d+)/)
    try {
      if (m) {
        const a = await api.assetById(token, m[1])
        if (!a?.id || a.status === 'error') throw new Error('Asset not found in Snipe-IT')
        showAsset(a)
      } else if (raw && raw.length <= 64 && !/\s/.test(raw) && !/^https?:/i.test(raw)) {
        await searchAndShow(raw)
      } else {
        throw new Error('That code is not a Snipe-IT asset label')
      }
    } catch (e) {
      toast.error((e as Error).message)
      void startCamera.current()
    }
  }

  const scanner = useScanner((text) => void processScan(text))

  startCamera.current = async () => {
    if (!location) return
    if (!QrScanner.isSupported()) {
      toast.error('Camera not available in this browser. Use “Type tag” or “Scan from photo”.')
      return
    }
    try {
      await scanner.start()
    } catch (e) {
      console.error(e)
      toast.error('Could not start the camera. Allow camera access, or use “Type tag” / “Scan from photo”.')
    }
  }

  const onStartScan = async () => {
    if (!requireLocation() || !(await guardUnlogged())) return
    setPanel('scan')
    void startCamera.current()
  }

  const onPhotoScan = async (file: File | undefined) => {
    if (!file) return
    await scanner.stop()
    const id = toast.loading('Reading code from photo…')
    try {
      const text = await QrScanner.decodeFile(file)
      toast.dismiss(id)
      if (!text) { toast.error('No code found. Fill the frame with the label and keep it sharp.'); return }
      navigator.vibrate?.(40)
      await processScan(text)
    } catch {
      toast.dismiss(id)
      toast.error('Could not read that photo')
    }
  }

  // ---- result actions ----
  const logAudit = async () => {
    if (!asset || !location) return
    setSaving(true)
    try {
      const r = await api.logAudit(token, {
        asset_id: asset.id,
        asset_tag: asset.asset_tag,
        asset_name: asset.name,
        sap_asset_number: extractSap(asset),
        expected_location_id: asset.location?.id || null,
        expected_location_name: asset.location?.name || 'Not assigned',
        actual_location_id: location.id,
        actual_location_name: location.name,
        notes: notes.trim(),
        user_name: userName,
      })
      setAuditCount((c) => c + 1)
      setSuccess({
        title: 'Audit logged',
        sub: `${asset.asset_tag} · ${r.status === 'match' ? 'location matches' : 'location mismatch'}` +
          (r.snipeit_audit_posted ? ' · saved in Snipe-IT' : ' · saved locally (Snipe-IT did not accept it)'),
        unregistered: false,
      })
      setAsset(null)
      setNotes('')
      setPanel('success')
      navigator.vibrate?.(30)
    } catch (e) {
      toast.error(`Failed to log audit: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const skip = async () => {
    if (!(await confirm({ title: 'Skip this asset?', description: 'It will NOT be logged.', confirmLabel: 'Skip' }))) return
    setAsset(null)
    setNotes('')
    setPanel('scan')
    void startCamera.current()
  }

  const logout = async () => {
    if (hasUnlogged && !(await confirm({ title: 'Log out?', description: 'You have an unlogged asset. Log out anyway?', confirmLabel: 'Log out' }))) return
    removeStoredToken('snipeit_token')
    window.location.reload()
  }

  const exportMine = async () => {
    try {
      downloadBlob(await api.exportUserAudits(userName), `my_audits_${userName}.xlsx`)
    } catch {
      toast.error('Failed to export audits')
    }
  }

  // ---- render ----
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2 px-4 py-2">
          <span className="font-semibold">Asset Audit</span>
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Account menu">
                  <Avatar size="sm"><AvatarFallback>{initials(user)}</AvatarFallback></Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div>{userName}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void exportMine()}><DownloadIcon /> Export my audits</DropdownMenuItem>
                <DropdownMenuItem asChild><a href="/admin"><ShieldIcon /> Admin dashboard</a></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void logout()}><LogOutIcon /> Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <main className="mx-auto flex max-w-lg flex-col gap-4 p-4">
        {!user && connecting && (
          <Card size="sm">
            <CardHeader>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Connecting with saved token…</CardContent>
          </Card>
        )}

        {!user && !connecting && (
          <Card>
            <CardHeader>
              <CardTitle>Connect to Snipe-IT</CardTitle>
              <CardDescription>Enter your personal API token to start auditing.</CardDescription>
            </CardHeader>
            <CardContent>
              <form id="connect-form" className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (tokenInput.trim()) void connect(tokenInput.trim()); else setSetupError('Please enter your API token.') }}>
                <Label htmlFor="api-token">API token</Label>
                <Input id="api-token" type="password" autoComplete="off" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} aria-invalid={!!setupError || undefined} />
                <p className="text-sm text-muted-foreground">In Snipe-IT: your name, Manage API Keys, Create New Token.</p>
                {setupError && <p className="text-sm text-destructive" role="alert">{setupError}</p>}
              </form>
            </CardContent>
            <CardFooter>
              <Button type="submit" form="connect-form" className="w-full">Connect</Button>
            </CardFooter>
          </Card>
        )}

        {user && (
          <>
            <LocationDrawer locations={locations} selected={location} open={locOpen} onOpenChange={setLocOpen} onSelect={selectLocation} />
            <p className="text-sm text-muted-foreground">
              {auditCount ? `${auditCount} audit${auditCount === 1 ? '' : 's'} logged by you` : 'No audits logged yet'}
              {scanner.features?.resolution ? ` · Camera ${scanner.features.resolution}` : ''}
            </p>

            <div className={panel === 'scan' ? 'flex flex-col gap-4' : 'hidden'}>
              <CameraCard scanner={scanner} canStart={!!location} onStart={() => void onStartScan()} />
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Can't scan?</CardTitle>
                  <CardDescription>Type the tag, read a photo of the label, or record an asset without a QR code.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  <Button variant="outline" onClick={async () => { if (requireLocation() && await guardUnlogged()) setManualOpen(true) }}>
                    <KeyboardIcon /> Type tag or SAP #
                  </Button>
                  <Button variant="outline" onClick={async () => { if (requireLocation() && await guardUnlogged()) photoRef.current?.click() }}>
                    <ImageIcon /> Scan from photo
                  </Button>
                  <Button variant="outline" onClick={async () => { if (requireLocation() && await guardUnlogged()) { await scanner.stop(); setNoqrOpen(true) } }}>
                    <PlusIcon /> No QR? Add with photo
                  </Button>
                </CardContent>
              </Card>
              <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { void onPhotoScan(e.target.files?.[0]); e.target.value = '' }} />
            </div>

            {panel === 'result' && asset && (
              <ResultCard asset={asset} location={location} notes={notes} onNotesChange={setNotes} saving={saving} onLog={() => void logAudit()} onSkip={() => void skip()} />
            )}

            {panel === 'success' && success && (
              <SuccessCard info={success} onNext={() => { setPanel('scan'); void startCamera.current() }} onDone={() => setPanel('scan')} />
            )}
          </>
        )}
      </main>

      <ManualEntryDrawer open={manualOpen} onOpenChange={setManualOpen} onSearch={async (q) => { await scanner.stop(); await searchAndShow(q) }} />
      <NoQrDrawer
        open={noqrOpen}
        onOpenChange={setNoqrOpen}
        token={token}
        location={location}
        userName={userName}
        onSaved={(r) => {
          if (r.registered) {
            setAuditCount((c) => c + 1)
            setSuccess({
              title: `Audit logged: ${r.snipeit_asset_tag}`,
              sub: [r.audit_status === 'match' ? 'location matches' : 'location mismatch',
                r.snipeit_audit_posted ? 'audit saved in Snipe-IT' : 'audit saved locally only',
                r.snipeit_photo_uploaded ? 'photo attached' : 'photo kept here (Snipe-IT upload failed)'].join(' · '),
              unregistered: false,
            })
          } else {
            setSuccess({ title: 'Saved as unregistered asset', sub: `${r.asset_number} is not in Snipe-IT. The record and photo are saved for admin review.`, unregistered: true })
          }
          setPanel('success')
        }}
      />
      {dialog}
    </div>
  )
}
