import { CheckIcon, ChevronRightIcon, MapPinIcon } from 'lucide-react'
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
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { cn } from '@/lib/utils'
import type { Location } from '@/lib/api'

interface Props {
  locations: Location[]
  selected: Location | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: number) => void
}

/** Responsive combobox pattern: Drawer + Command list. */
export function LocationDrawer({ locations, selected, open, onOpenChange, onSelect }: Props) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>
        <Item
          asChild
          variant="outline"
          className={cn(
            'min-h-14 w-full bg-card text-left',
            !selected && 'border-dashed border-warning/60 bg-warning/5',
          )}
        >
          <button type="button">
            <ItemMedia variant="icon" className={cn('size-9 rounded-md', selected ? 'bg-primary/10 text-primary' : 'bg-warning/15 text-warning')}>
              <MapPinIcon />
            </ItemMedia>
            <ItemContent className="gap-0">
              <ItemDescription className="text-xs font-semibold uppercase tracking-wide">
                {selected ? 'You are at' : 'Step 1'}
              </ItemDescription>
              <ItemTitle className="text-base font-semibold">{selected ? selected.name : 'Choose your current location'}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <ChevronRightIcon className="size-5 text-muted-foreground" />
            </ItemActions>
          </button>
        </Item>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>Where are you?</DrawerTitle>
          <DrawerDescription>Audits compare each asset with this location.</DrawerDescription>
        </DrawerHeader>
        <Command className="min-h-0 flex-1 rounded-none bg-transparent px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
          <CommandInput placeholder="Search locations…" className="h-11" />
          <CommandList className="max-h-[60dvh]">
            <CommandEmpty>No locations found.</CommandEmpty>
            <CommandGroup>
              {locations.map((l) => (
                <CommandItem
                  key={l.id}
                  value={`${l.name} ${l.id}`}
                  onSelect={() => { onSelect(l.id); onOpenChange(false) }}
                  className="min-h-11 text-base"
                >
                  <span className="flex-1">{l.name}</span>
                  {selected?.id === l.id && <CheckIcon className="text-success" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DrawerContent>
    </Drawer>
  )
}
