import { useEffect, useState, type FormEvent } from 'react'
import { SearchIcon } from 'lucide-react'
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
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
    if (!q) { setError('Enter an asset tag or SAP number'); return }
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
        <form onSubmit={submit} className="mx-auto flex w-full max-w-lg flex-col">
          <DrawerHeader className="pb-2">
            <DrawerTitle>Type asset tag or SAP #</DrawerTitle>
            <DrawerDescription>Works with asset tags and SAP asset numbers.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4">
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="manual-query">Asset tag or SAP number</FieldLabel>
              <Input
                id="manual-query"
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="search"
                placeholder="e.g. MJ-00123 or 400012345"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-invalid={!!error || undefined}
                className="h-11"
              />
              {error && <FieldError>{error}</FieldError>}
            </Field>
          </div>
          <DrawerFooter className="flex-row pb-[max(env(safe-area-inset-bottom),1rem)]">
            <DrawerClose asChild>
              <Button type="button" variant="outline" size="touch" className="flex-1">Cancel</Button>
            </DrawerClose>
            <Button type="submit" size="touch" disabled={busy} className="flex-1">
              {busy ? <Spinner /> : <SearchIcon />} Find asset
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
