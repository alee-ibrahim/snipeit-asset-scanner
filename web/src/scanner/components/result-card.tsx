import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { extractSap } from '@/lib/helpers'
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

  const rows: Array<[string, string]> = [
    ['Model', asset.model?.name || '–'],
    ['Serial', asset.serial || '–'],
    ['SAP #', extractSap(asset) || '–'],
    ['Recorded location', expectedName || 'Not assigned'],
    ['Your location', location?.name || '–'],
  ]

  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{asset.asset_tag || 'No tag'}</CardDescription>
        <CardTitle>{asset.name || asset.model?.name || 'Unnamed asset'}</CardTitle>
        <CardAction>
          <Badge variant={isMatch ? 'default' : 'destructive'}>{isMatch ? 'Match' : 'Mismatch'}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert variant={isMatch ? 'default' : 'destructive'} role="status">
          <AlertTitle>{isMatch ? 'Location matches' : expectedName ? 'Wrong location' : 'No location in Snipe-IT'}</AlertTitle>
          <AlertDescription>
            {isMatch
              ? `Recorded at ${expectedName}.`
              : expectedName
                ? `Recorded at ${expectedName}, but you are at ${location?.name}.`
                : `Will be logged as a mismatch, found at ${location?.name}.`}
          </AlertDescription>
        </Alert>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <Separator />
        <div className="grid gap-2">
          <Label htmlFor="audit-notes">Notes (optional)</Label>
          <Textarea id="audit-notes" value={notes} onChange={(e) => onNotesChange(e.target.value)} placeholder="Condition, who uses it, etc." />
        </div>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        <Button className="w-full" onClick={onLog} disabled={saving}>{saving && <Spinner />} Log audit</Button>
        <Button className="w-full" variant="outline" onClick={onSkip}>Skip</Button>
      </CardFooter>
    </Card>
  )
}
