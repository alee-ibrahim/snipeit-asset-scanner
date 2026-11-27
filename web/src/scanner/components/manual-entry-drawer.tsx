import { useEffect, useState, type FormEvent } from 'react'
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

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearch: (query: string) => Promise<void>
}

/** Type an asset tag or SAP number. */
export function ManualEntryDrawer({ open, onOpenChange, onSearch }: Props) {
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) { setQuery(''); setError(null) } }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) { setError('Enter an asset tag or SAP number.'); return }
    setBusy(true)
    setError(null)
    try {
      await onSearch(q)
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent>
        <form onSubmit={submit} className="mx-auto w-full max-w-lg">
          <DrawerHeader>
            <DrawerTitle>Type asset tag or SAP #</DrawerTitle>
            <DrawerDescription>Works with asset tags and SAP asset numbers.</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-2 px-4">
            <Label htmlFor="manual-query">Asset tag or SAP number</Label>
            <Input id="manual-query" autoFocus autoComplete="off" autoCapitalize="characters" enterKeyHint="search"
              placeholder="e.g. MJ-00123 or 400012345" value={query} onChange={(e) => setQuery(e.target.value)} aria-invalid={!!error || undefined} />
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
          <DrawerFooter>
            <Button type="submit" disabled={busy}>{busy && <Spinner />} Find asset</Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
