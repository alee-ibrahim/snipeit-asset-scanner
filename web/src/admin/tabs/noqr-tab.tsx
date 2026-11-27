import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { useConfirm } from '@/hooks/use-confirm'
import { adminApi, type ManualAsset } from '@/lib/api'
import { formatDate } from '@/lib/helpers'
import { DataTable, SortHeader } from '../components/data-table'

interface Props {
  password: string
  records: ManualAsset[]
  reload: () => Promise<void>
  confirm: ReturnType<typeof useConfirm>['confirm']
}

export function NoQrTab({ password, records, reload, confirm }: Props) {
  const [filter, setFilter] = useState('all')
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
      cell: ({ row }) => row.original.photo_url
        ? (
          <Button variant="outline" size="icon-lg" className="overflow-hidden p-0" onClick={() => setPreview(row.original)} aria-label={`View photo of ${row.original.asset_number}`}>
            <img src={row.original.photo_url} alt="" loading="lazy" className="size-full object-cover" />
          </Button>
        )
        : '–',
    },
    { accessorKey: 'created_at', header: ({ column }) => <SortHeader column={column} title="Date" />, cell: ({ row }) => formatDate(row.original.created_at, true) },
    { accessorKey: 'asset_number', header: ({ column }) => <SortHeader column={column} title="Asset number" /> },
    {
      accessorKey: 'description',
      header: ({ column }) => <SortHeader column={column} title="Description" />,
      cell: ({ row }) => (
        <div>
          <div>{row.original.description}</div>
          {row.original.notes && <div className="text-xs text-muted-foreground">{row.original.notes}</div>}
        </div>
      ),
    },
    {
      accessorKey: 'registered',
      header: ({ column }) => <SortHeader column={column} title="Snipe-IT" />,
      cell: ({ row }) => {
        const r = row.original
        if (!r.registered) return <Badge variant="outline">Unregistered</Badge>
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge variant="secondary">Registered</Badge>
            <span className="text-xs text-muted-foreground">{r.snipeit_asset_tag}{r.snipeit_asset_name ? `, ${r.snipeit_asset_name}` : ''}</span>
            <span className="text-xs text-muted-foreground">Audit {r.snipeit_audit_posted ? 'posted' : 'not posted'}, photo {r.snipeit_photo_uploaded ? 'attached' : 'not attached'}</span>
          </div>
        )
      },
    },
    { accessorKey: 'location_name', header: ({ column }) => <SortHeader column={column} title="Found at" />, cell: ({ row }) => row.original.location_name || '–' },
    {
      accessorKey: 'audit_status',
      header: ({ column }) => <SortHeader column={column} title="Location check" />,
      cell: ({ row }) => row.original.audit_status ? (
        <div className="flex flex-col items-start gap-1">
          <Badge variant={row.original.audit_status === 'match' ? 'default' : 'destructive'}>{row.original.audit_status}</Badge>
          {row.original.expected_location_name && <span className="text-xs text-muted-foreground">recorded: {row.original.expected_location_name}</span>}
        </div>
      ) : '–',
    },
    { accessorKey: 'user_name', header: ({ column }) => <SortHeader column={column} title="Recorded by" />, cell: ({ row }) => row.original.user_name || '–' },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => <Button size="icon-sm" variant="destructive" aria-label="Delete" onClick={() => void remove(row.original.id)}><Trash2Icon /></Button>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [password])

  const stats: Array<[string, number]> = [
    ['All records', records.length],
    ['Found in Snipe-IT', records.filter((r) => r.registered).length],
    ['Unregistered', records.filter((r) => !r.registered).length],
    ['Photos attached in Snipe-IT', records.filter((r) => r.snipeit_photo_uploaded).length],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map(([label, value]) => (
          <Card key={label} size="sm">
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle>{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" className="w-full sm:max-w-sm" placeholder="Search number, description, location, user" aria-label="Search no-QR records" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger aria-label="Filter records"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All records</SelectItem>
            <SelectItem value="registered">Found in Snipe-IT</SelectItem>
            <SelectItem value="unregistered">Unregistered</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => void reload()}>Refresh</Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        initialSort={[{ id: 'created_at', desc: true }]}
        getRowId={(r) => String(r.id)}
        emptyTitle="No records"
        emptyDescription="Assets added with “No QR? Add with photo” appear here."
        minWidth={1000}
      />

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null) }}>
        <DialogContent className="sm:max-w-2xl">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle>{preview.asset_number}: {preview.description}</DialogTitle>
                <DialogDescription>
                  {preview.registered ? `Registered (${preview.snipeit_asset_tag})` : 'Unregistered'}, {preview.location_name}, {preview.user_name}, {formatDate(preview.created_at, true)}
                </DialogDescription>
              </DialogHeader>
              <img src={preview.photo_url ?? ''} alt={`Photo of ${preview.asset_number}`} className="max-h-[60dvh] w-full rounded-md border object-contain" />
              <DialogFooter>
                <Button asChild variant="outline">
                  <a href={preview.photo_url ?? '#'} target="_blank" rel="noopener">Open full size</a>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
