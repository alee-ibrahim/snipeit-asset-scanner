import { CircleAlertIcon, CircleCheckIcon, CircleHelpIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { extractSap } from '@/lib/helpers'
import { cn } from '@/lib/utils'
import type { Asset, Location } from '@/lib/api'

interface Props {
  asset: Asset
  location: Location | null
  notes: string
  onNotesChange: (v: string) => void
  saving: boolean
  onLog: () => void
  onSkip: () => void
}

export function ResultCard({ asset, location, notes, onNotesChange, saving, onLog, onSkip }: Props) {
  const expectedName = asset.location?.name
  const isMatch = !!location && asset.location?.id === location.id
  const state = isMatch ? 'ok' : expectedName ? 'bad' : 'warn'

  const Icon = state === 'ok' ? CircleCheckIcon : state === 'bad' ? CircleAlertIcon : CircleHelpIcon
  const title = state === 'ok' ? 'Location matches' : state === 'bad' ? 'Wrong location' : 'No location in Snipe-IT'
  const sub = state === 'ok'
    ? `Recorded at ${expectedName}.`
    : state === 'bad'
      ? `Recorded at ${expectedName}, but you are at ${location?.name}.`
      : `Will be logged as a mismatch, found at ${location?.name}.`

  const rows: Array<[string, string]> = [
    ['Model', asset.model?.name || '–'],
    ['Serial', asset.serial || '–'],
    ['SAP #', extractSap(asset) || '–'],
    ['Recorded location', expectedName || 'Not assigned'],
    ['Your location', location?.name || '–'],
  ]

  return (
    <div className="flex flex-col gap-3">
      <Alert
        role="status"
        className={cn(
          'border-2 py-3 [&>svg]:size-6',
          state === 'ok' && 'border-success bg-success/10 text-success',
          state === 'bad' && 'border-destructive bg-destructive/10 text-destructive',
          state === 'warn' && 'border-warning bg-warning/10 text-warning',
        )}
      >
        <Icon />
        <AlertTitle className="text-base font-bold">{title}</AlertTitle>
        <AlertDescription className="text-foreground">{sub}</AlertDescription>
      </Alert>

      <Card size="sm">
        <CardHeader>
          <CardDescription className="font-mono text-xs font-semibold">{asset.asset_tag || 'No tag'}</CardDescription>
          <CardTitle className="text-lg! leading-snug font-bold">{asset.name || asset.model?.name || 'Unnamed asset'}</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Field>
        <FieldLabel htmlFor="audit-notes">Notes <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
        <Textarea id="audit-notes" rows={2} value={notes} onChange={(e) => onNotesChange(e.target.value)} placeholder="Condition, who uses it, etc." />
      </Field>

      <Button size="touch-lg" onClick={onLog} disabled={saving} className="w-full bg-success text-success-foreground hover:bg-success/90">
        {saving ? <Spinner /> : <CircleCheckIcon />} Log audit
      </Button>
      <Button size="touch" variant="outline" onClick={onSkip} className="w-full">Skip – don't log</Button>
    </div>
  )
}
