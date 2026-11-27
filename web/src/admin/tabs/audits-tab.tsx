import { useMemo, useState } from 'react'
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table'
import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import type { useConfirm } from '@/hooks/use-confirm'
import { adminApi, type AuditRecord, type AuditStatus } from '@/lib/api'
import { formatDate, setStoredToken } from '@/lib/helpers'
import { DataTable, SortHeader } from '../components/data-table'

interface Props {
  password: string
  audits: AuditRecord[]
  reload: () => Promise<void>
  resolveToken: string
  setResolveToken: (t: string) => void
  confirm: ReturnType<typeof useConfirm>['confirm']
}

const statusVariant: Record<AuditStatus, 'default' | 'destructive' | 'secondary'> = {
  match: 'default',
  mismatch: 'destructive',
  resolved: 'secondary',
}

export function AuditsTab({ password, audits, reload, resolveToken, setResolveToken, confirm }: Props) {
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<RowSelectionState>({})
  const [tokenInput, setTokenInput] = useState('')
  const [resolving, setResolving] = useState(false)

  const count = (s: string) => audits.filter((a) => a.status === s).length
  const mismatches = count('mismatch')

  const rows = useMemo(() => {
    const term = search.toLowerCase()
    return audits.filter((a) =>
      (status === 'all' || a.status === status) &&
      (!term || [a.asset_tag, a.asset_name, a.sap_asset_number].some((v) => v?.toLowerCase().includes(term))))
  }, [audits, status, search])

  const selectedIds = Object.keys(selection).filter((k) => selection[k]).map(Number)

  const resolve = async (ids: number[]) => {
    if (!resolveToken) { toast.error('Save your Snipe-IT API token first'); return }
    const ok = await confirm({
      title: ids.length > 1 ? 'Resolve selected?' : 'Resolve mismatch?',
      description: `This updates the location of ${ids.length} asset(s) in Snipe-IT to where they were found.`,
      confirmLabel: 'Resolve',
      destructive: false,
    })
    if (!ok) return
    setResolving(true)
    try {
      const r = await adminApi.resolve(password, resolveToken, ids)
      if (r.resolved > 0) {
        toast.success(`Resolved ${r.resolved} audit(s).${r.failed ? ` ${r.failed} failed.` : ''}`)
        setSelection({})
        await reload()
      } else if (r.errors?.length) {
        toast.error('Failed to resolve: ' + r.errors.map((e) => (typeof e.error === 'string' ? e.error : JSON.stringify(e.error))).join(', '))
      }
    } catch (e) {
      toast.error(`Failed to resolve: ${(e as Error).message}`)
    } finally {
      setResolving(false)
    }
  }

  const remove = async (id: number) => {
    if (!(await confirm({ title: 'Delete audit record?', description: 'This removes the local record only. Snipe-IT is not changed.', confirmLabel: 'Delete' }))) return
    await adminApi.deleteAudit(password, id).catch(() => toast.error('Failed to delete'))
    await reload()
  }

  const clearAll = async () => {
    if (!(await confirm({ title: 'Delete all audit records?', description: 'This cannot be undone. Snipe-IT is not changed.', confirmLabel: 'Delete all' }))) return
    for (const a of audits) await adminApi.deleteAudit(password, a.id).catch(() => {})
    await reload()
  }

  const columns = useMemo<ColumnDef<AuditRecord, unknown>[]>(() => [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all mismatches"
          checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false}
          onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
        />
      ),
      cell: ({ row }) => row.getCanSelect()
        ? <Checkbox aria-label={`Select ${row.original.asset_tag}`} checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} />
        : null,
      enableSorting: false,
    },
    { accessorKey: 'created_at', header: ({ column }) => <SortHeader column={column} title="Date" />, cell: ({ row }) => formatDate(row.original.created_at, true) },
    { accessorKey: 'asset_tag', header: ({ column }) => <SortHeader column={column} title="Asset tag" /> },
    { accessorKey: 'asset_name', header: ({ column }) => <SortHeader column={column} title="Asset name" />, cell: ({ row }) => row.original.asset_name || '–' },
    { accessorKey: 'sap_asset_number', header: ({ column }) => <SortHeader column={column} title="SAP #" />, cell: ({ row }) => row.original.sap_asset_number || '–' },
    { accessorKey: 'expected_location_name', header: ({ column }) => <SortHeader column={column} title="Expected" />, cell: ({ row }) => row.original.expected_location_name || '–' },
    { accessorKey: 'actual_location_name', header: ({ column }) => <SortHeader column={column} title="Found at" /> },
    {
      accessorKey: 'status',
      header: ({ column }) => <SortHeader column={column} title="Status" />,
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <Badge variant={statusVariant[row.original.status]}>{row.original.status}</Badge>
          {row.original.resolved_at && <span className="text-xs text-muted-foreground">by {row.original.resolved_by}, {formatDate(row.original.resolved_at, true)}</span>}
        </div>
      ),
    },
    { accessorKey: 'user_name', header: ({ column }) => <SortHeader column={column} title="Audited by" />, cell: ({ row }) => row.original.user_name || '–' },
    {
      accessorKey: 'snipeit_audit_posted',
      header: ({ column }) => <SortHeader column={column} title="Posted" />,
      cell: ({ row }) => <Badge variant={row.original.snipeit_audit_posted ? 'secondary' : 'outline'}>{row.original.snipeit_audit_posted ? 'Yes' : 'No'}</Badge>,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex gap-2">
          {row.original.status === 'mismatch' && <Button size="sm" onClick={() => void resolve([row.original.id])}>Resolve</Button>}
          <Button size="icon-sm" variant="destructive" aria-label="Delete" onClick={() => void remove(row.original.id)}><Trash2Icon /></Button>
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [resolveToken, password, audits])

  const stats: Array<[string, number]> = [
    ['Total audits', audits.length],
    ['Matches', count('match')],
    ['Mismatches', mismatches],
    ['Resolved', count('resolved')],
    ['Posted to Snipe-IT', audits.filter((a) => a.snipeit_audit_posted).length],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {stats.map(([label, value]) => (
          <Card key={label} size="sm">
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle>{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {mismatches > 0 && !resolveToken && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Snipe-IT API token</CardTitle>
            <CardDescription>Needed to resolve mismatches (updates the asset location in Snipe-IT).</CardDescription>
          </CardHeader>
          <CardContent>
            <form id="resolve-token-form" className="grid gap-2" onSubmit={(e) => {
              e.preventDefault()
              const t = tokenInput.trim()
              if (!t) return
              setResolveToken(t)
              setStoredToken('audit_snipeit_token', t)
              toast.success('Token saved')
            }}>
              <Label htmlFor="resolve-token">API token</Label>
              <Input id="resolve-token" type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
            </form>
          </CardContent>
          <CardFooter>
            <Button type="submit" form="resolve-token-form">Save token</Button>
          </CardFooter>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" className="w-full sm:max-w-sm" placeholder="Search tag, name or SAP #" aria-label="Search audits" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="match">Match</SelectItem>
            <SelectItem value="mismatch">Mismatch</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        {mismatches > 0 && (
          <>
            <Button disabled={!selectedIds.length || !resolveToken || resolving} onClick={() => void resolve(selectedIds)}>
              {resolving && <Spinner />} Resolve selected ({selectedIds.length})
            </Button>
            {selectedIds.length > 0 && <Button variant="outline" onClick={() => setSelection({})}>Clear selection</Button>}
          </>
        )}
        {audits.length > 0 && <Button variant="destructive" className="sm:ml-auto" onClick={() => void clearAll()}>Clear all</Button>}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        initialSort={[{ id: 'created_at', desc: true }]}
        getRowId={(r) => String(r.id)}
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        enableRowSelection={(row) => row.original.status === 'mismatch'}
        emptyTitle="No audit records"
        emptyDescription="Scan assets with the scanner app to see records here."
        minWidth={1080}
      />
    </div>
  )
}
