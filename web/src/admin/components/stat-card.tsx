import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const tones = {
  default: 'text-foreground',
  success: 'text-success',
  destructive: 'text-destructive',
  warning: 'text-warning',
  info: 'text-blue-700',
} as const

interface Props {
  label: string
  value: number | string
  tone?: keyof typeof tones
  selected?: boolean
  onClick?: () => void
}

/** Compact KPI card; clickable when used as a filter. */
export function StatCard({ label, value, tone = 'default', selected, onClick }: Props) {
  const card = (
    <Card size="sm" className={cn('gap-1 transition-shadow', onClick && 'hover:ring-foreground/25', selected && 'ring-2 ring-primary')}>
      <CardHeader className="gap-0.5">
        <CardDescription className="text-xs font-medium sm:text-sm">{label}</CardDescription>
        <CardTitle className={cn('text-2xl! leading-tight font-bold tabular-nums sm:text-3xl!', tones[tone])}>{value}</CardTitle>
      </CardHeader>
    </Card>
  )
  if (!onClick) return card
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className="rounded-xl text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {card}
    </button>
  )
}

export function StatusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case 'match': return 'border-success/30 bg-success/10 text-success'
    case 'mismatch': return 'border-destructive/30 bg-destructive/10 text-destructive'
    case 'resolved': return 'border-blue-600/30 bg-blue-600/10 text-blue-700'
    default: return ''
  }
}
