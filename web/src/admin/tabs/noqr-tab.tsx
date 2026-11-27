import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { ExternalLinkIcon, RefreshCwIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import type { useConfirm } from '@/hooks/use-confirm'
import { adminApi, type ManualAsset } from '@/lib/api'
import { formatDate } from '@/lib/helpers'
import { cn } from '@/lib/utils'
import { DataTable, SortHeader } from '../components/data-table'
import { StatCard, StatusBadgeClass } from '../components/stat-card'

interface Props {
  password: string
  records: ManualAsset[]
  reload: () => Promise<void>
  confirm: ReturnType<typeof useConfirm>['confirm']
}

type Filter = 'all' | 'registered' | 'unregistered'

export function NoQrTab({ password, records, reload, confirm }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState<ManualAsset | null>(null)

  const rows = useMemo(() => {
    const term = search.toLowerCase()
    return records.filter((r) =>
      (filter === 'all' || (filter === 'registered' ? !!r.registered : !r.registered)) &&
      (!term || [r.asset_number, r.description, r.location_name, r.user_name, r.snipeit_asset_tag, r.snipeit_asset_name, r.notes]
        .some((v) => v?.toLowerCase().includes(term))))
  }, [records, filter, search])

  const remove = async (id: number) => {
    const ok = await confirm({
      title: 'Delete this record?',
      description: 'The record and its photo are removed from this app. Any audit already posted to Snipe-IT stays there.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    await adminApi.deleteManualAsset(password, id).catch(() => toast.error('Failed to delete'))
    await reload()
  }

  const columns = useMemo<ColumnDef<ManualAsset, unknown>[]>(() => [
    {
      id: 'photo',
      header: 'Photo',
      enableSorting: false,
      cell: ({ row }) => row.original.photo_url ? (
        <Button variant="ghost" className="size-11 overflow-hidden rounded-md p-0" aria-label={`View photo of ${row.original.asset_number}`} onClick={() => setPreview(row.original)}>
          <img src={row.original.photo_url} alt="" loading="lazy" className="size-11 rounded-md border object-cover" />
        </Button>
      ) : <span className="text-muted-foreground">–</span>,
    },
    { accessorKey: 'created_at', header: ({ column }) => <SortHeader column={column} title="Date" />, cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.created_at, true)}</span> },
    { accessorKey: 'asset_number', header: ({ column }) => <SortHeader column={column} title="Asset number" />, cell: ({ row }) => <span className="font-mono font-semibold whitespace-nowrap">{row.original.asset_number}</span> },
    {
      accessorKey: 'description',
      header: ({ column }) => <SortHeader column={column} title="Description" />,
      cell: ({ row }) => (
        <div className="min-w-36">
          <div>{row.original.description}</div>
          {row.original.notes && <div className="text-[11px] text-muted-foreground">{row.original.notes}</div>}
        </div>
      ),
    },
    {
      accessorKey: 'registered',
      header: ({ column }) => <SortHeader column={column} title="Snipe-IT" />,
      cell: ({ row }) => {
        const r = row.original
        if (!r.registered) return <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning uppercase">Unregistered</Badge>
        return (
          <div className="flex flex-col items-start gap-0.5 whitespace-nowrap">
            <Badge variant="outline" className="border-success/40 bg-success/10 text-success uppercase">Registered</Badge>
            <span className="text-[11px] text-muted-foreground">{r.snipeit_asset_tag}{r.snipeit_asset_name ? ` · ${r.snipeit_asset_name}` : ''}</span>
            <span className="text-[11px] text-muted-foreground">Audit {r.snipeit_audit_posted ? 'posted' : 'not posted'} · photo {r.snipeit_photo_uploaded ? 'attached' : 'not attached'}</span>
          </div>
        )
      },
    },
    { accessorKey: 'location_name', header: ({ column }) => <SortHeader column={column} title="Found at" />, cell: ({ row }) => row.original.location_name || '–' },
    {
      accessorKey: 'audit_status',
      header: ({ column }) => <SortHeader column={column} title="Location check" />,
      cell: ({ row }) => row.original.audit_status ? (
        <div className="flex flex-col items-start gap-0.5 whitespace-nowrap">
          <Badge variant="outline" className={cn('uppercase', StatusBadgeClass(row.original.audit_status))}>{row.original.audit_status}</Badge>
          {row.original.expected_location_name && <span className="text-[11px] text-muted-foreground">recorded: {row.original.expected_location_name}</span>}
        </div>
      ) : <span className="text-muted-foreground">–</span>,
    },
    { accessorKey: 'user_name', header: ({ column }) => <SortHeader column={column} title="Recorded by" />, cell: ({ row }) => row.original.user_name || '–' },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => <Button size="icon" variant="destructive" className="size-9" aria-label="Delete" onClick={() => void remove(row.original.id)}><Trash2Icon /></Button>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [password])

  const stat = (f: Filter, label: string, value: number, tone: 'default' | 'success' | 'warning') => (
    <StatCard label={label} value={value} tone={tone} selected={filter === f} onClick={() => setFilter(f)} />
  )

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {stat('all', 'All records', records.length, 'default')}
        {stat('registered', 'Found in Snipe-IT', records.filter((r) => r.registered).length, 'success')}
        {stat('unregistered', 'Unregistered', records.filter((r) => !r.registered).length, 'warning')}
        <StatCard label="Photos attached in Snipe-IT" value={records.filter((r) => r.snipeit_photo_uploaded).length} tone="info" />
      </div>

      <div className="flex items-center gap-2">
        <InputGroup className="h-11 min-w-0 flex-1 bg-card sm:max-w-sm">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput type="search" placeholder="Search number, description, location, user" aria-label="Search no-QR records" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        <Button size="touch" variant="outline" className="sm:ml-auto" onClick={() => void reload()}><RefreshCwIcon /> Refresh</Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        initialSort={[{ id: 'created_at', desc: true }]}
        getRowId={(r) => String(r.id)}
        emptyTitle="No records"
        emptyDescription="Assets added with “No QR? Add with photo” in the scanner appear here."
        minWidth={1000}
      />

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null) }}>
        <DialogContent className="max-h-[92dvh] gap-3 overflow-y-auto p-0 sm:max-w-3xl">
          {preview && (
            <>
              <DialogHeader className="px-4 pt-4">
                <DialogTitle>{preview.asset_number} – {preview.description}</DialogTitle>
                <DialogDescription>{preview.registered ? `Registered (${preview.snipeit_asset_tag})` : 'Unregistered'} · {preview.location_name} · {formatDate(preview.created_at, true)}</DialogDescription>
              </DialogHeader>
              <div className="flex justify-center bg-slate-950">
                <img src={preview.photo_url ?? ''} alt={`Photo of ${preview.asset_number}`} className="max-h-[60dvh] w-auto max-w-full object-contain" />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 text-sm">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {([['Location check', preview.audit_status ? `${preview.audit_status} (recorded: ${preview.expected_location_name || '–'})` : null],
                    ['Recorded by', preview.user_name], ['Notes', preview.notes]] as const)
                    .filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
                    ))}
                </dl>
                <Button asChild size="touch" variant="outline">
                  <a href={preview.photo_url ?? '#'} target="_blank" rel="noopener"><ExternalLinkIcon /> Open full size</a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
