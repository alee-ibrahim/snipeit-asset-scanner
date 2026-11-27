import { CheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import type { Location } from '@/lib/api'

interface Props {
  locations: Location[]
  selected: Location | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: number) => void
}

/** Current location card; the picker is a Drawer with a Command list (shadcn responsive combobox pattern). */
export function LocationDrawer({ locations, selected, open, onOpenChange, onSelect }: Props) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>Current location</CardDescription>
        <CardTitle>{selected ? selected.name : 'Not selected'}</CardTitle>
        <CardAction>
          <Drawer open={open} onOpenChange={onOpenChange}>
            <DrawerTrigger asChild>
              <Button variant={selected ? 'outline' : 'default'}>{selected ? 'Change' : 'Choose'}</Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Where are you?</DrawerTitle>
                <DrawerDescription>Audits compare each asset with this location.</DrawerDescription>
              </DrawerHeader>
              <Command className="px-2 pb-4">
                <CommandInput placeholder="Search locations…" />
                <CommandList>
                  <CommandEmpty>No locations found.</CommandEmpty>
                  <CommandGroup>
                    {locations.map((l) => (
                      <CommandItem key={l.id} value={`${l.name} ${l.id}`} onSelect={() => { onSelect(l.id); onOpenChange(false) }}>
                        {l.name}
                        {selected?.id === l.id && <CheckIcon className="ml-auto" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </DrawerContent>
          </Drawer>
        </CardAction>
      </CardHeader>
    </Card>
  )
}
