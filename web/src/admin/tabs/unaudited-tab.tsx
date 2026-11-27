import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DownloadIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { adminApi, downloadBlob, type SnipeAssetRow, type SnipeAssetsResponse } from '@/lib/api'
import { formatDate, getStoredToken, setStoredToken } from '@/lib/helpers'
import { DataTable, SortHeader } from '../components/data-table'
import { StatCard } from '../components/stat-card'

type Filter = 'all' | 'never' | 'not-this-year' | 'overdue'

const sets: Record<Filter, { title: string; file: string; pick: (d: SnipeAssetsResponse) => SnipeAssetRow[] }> = {
  all: { title: 'All assets', file: 'all_assets.csv', pick: (d) => d.all_assets },
  never: { title: 'Never audited', file: 'never_audited_assets.csv', pick: (d) => d.never_audited },
  'not-this-year': { title: 'Not audited this year', file: 'not_audited_this_year.csv', pick: (d) => d.not_audited_this_year },
  overdue: { title: 'Audit overdue', file: 'audit_overdue_assets.csv', pick: (d) => d.audit_overdue },
}

export function UnauditedTab({ password }: { password: string }) {
  const [savedToken, setSavedToken] = useState(() => getStoredToken('snipeit_api_token') || '')
  const [tokenInput, setTokenInput] = useState('')
  const [data, setData] = useState<SnipeAssetsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const fetchAssets = async (refresh: boolean) => {
    const token = tokenInput.trim() || savedToken
    if (!token) { toast.error('Enter your Snipe-IT API token'); return }
    setStoredToken('snipeit_api_token', token)
    setSavedToken(token)
    setLoading(true)
    try {
      setData(await adminApi.snipeAssets(password, token, refresh))
    } catch (e) {
      toast.error(`Failed to fetch assets: ${(e as Error).message}`)
      setSavedToken('')
    } finally {
      setLoading(false)
    }
  }

  const rows = useMemo(() => {
    if (!data) return []
    const term = search.toLowerCase()
    const list = sets[filter].pick(data)
    return term ? list.filter((a) => [a.asset_tag, a.name, a.location, a.model, a.sap_asset_number].some((v) => v?.toLowerCase().includes(term))) : list
  }, [data, filter, search])

  const exportCsv = () => {
    const headers = ['Asset Tag', 'Name', 'SAP Asset #', 'Model', 'Category', 'Location', 'Assigned To', 'Last Audit', 'Next Audit', 'Status']
    let csv = headers.join(',') + '\n'
    for (const a of rows) {
      csv += [a.asset_tag, a.name, a.sap_asset_number, a.model, a.category, a.location, a.assigned_to, a.last_audit_date || 'Never', a.next_audit_date, a.status]
        .map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',') + '\n'
    }
    downloadBlob(new Blob([csv], { type: 'text/csv' }), sets[filter].file)
  }

  const columns = useMemo<ColumnDef<SnipeAssetRow, unknown>[]>(() => {
    const text = (key: keyof SnipeAssetRow, title: string, mono = false): ColumnDef<SnipeAssetRow, unknown> => ({
      accessorKey: key,
      header: ({ column }) => <SortHeader column={column} title={title} />,
      cell: ({ row }) => <span className={mono ? 'font-mono font-semibold whitespace-nowrap' : undefined}>{(row.original[key] as string) || '–'}</span>,
    })
    return [
      text('asset_tag', 'Asset tag', true), text('name', 'Name'), text('sap_asset_number', 'SAP #'), text('model', 'Model'),
      text('category', 'Category'), text('location', 'Location'), text('assigned_to', 'Assigned to'),
      {
        accessorKey: 'last_audit_date',
        header: ({ column }) => <SortHeader column={column} title="Last audit" />,
        cell: ({ row }) => row.original.last_audit_date
          ? <span className="whitespace-nowrap">{formatDate(row.original.last_audit_date)}</span>
          : <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive uppercase">Never</Badge>,
      },
      { accessorKey: 'next_audit_date', header: ({ column }) => <SortHeader column={column} title="Next audit" />, cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.next_audit_date)}</span> },
      text('status', 'Status'),
    ]
  }, [])

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <Card size="sm" className="bg-blue-50 ring-blue-200">
        <CardContent>
          <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); void fetchAssets(false) }}>
            {!savedToken && (
              <Field className="flex-1">
                <FieldLabel htmlFor="assets-token">Snipe-IT API token (needed to fetch assets)</FieldLabel>
                <Input id="assets-token" type="password" className="h-11 bg-card" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
              </Field>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="touch" disabled={loading} className="flex-1 sm:flex-none">{loading && <Spinner />} {data ? 'Reload' : 'Fetch assets'}</Button>
              {data && <Button type="button" size="touch" variant="outline" disabled={loading} onClick={() => void fetchAssets(true)}><RefreshCwIcon /> Refresh from Snipe-IT</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      {data?.cached && !loading && (
        <Alert className="border-success/30 bg-success/10 py-2">
          <AlertDescription>Loaded from cache ({data.cache_age} s old). Use “Refresh from Snipe-IT” for fresh data.</AlertDescription>
        </Alert>
      )}

      {loading && (
        <div className="flex flex-col gap-2" aria-busy>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <StatCard label="Total assets" value={data.total} tone="info" selected={filter === 'all'} onClick={() => setFilter('all')} />
            <StatCard label="Never audited" value={data.never_audited.length} tone="destructive" selected={filter === 'never'} onClick={() => setFilter('never')} />
            <StatCard label="Not audited this year" value={data.not_audited_this_year.length} tone="warning" selected={filter === 'not-this-year'} onClick={() => setFilter('not-this-year')} />
            <StatCard label="Audit overdue" value={data.audit_overdue.length} selected={filter === 'overdue'} onClick={() => setFilter('overdue')} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="h-11 min-w-0 flex-1 basis-full bg-card sm:basis-auto sm:max-w-sm">
              <InputGroupAddon><SearchIcon /></InputGroupAddon>
              <InputGroupInput type="search" placeholder="Search tag, name, SAP #, model, location" aria-label="Search assets" value={search} onChange={(e) => setSearch(e.target.value)} />
            </InputGroup>
            <span className="text-sm text-muted-foreground">{sets[filter].title}: {rows.length}</span>
            <Button size="touch" className="bg-success text-success-foreground hover:bg-success/90 sm:ml-auto" onClick={exportCsv}><DownloadIcon /> Export CSV</Button>
          </div>
          <DataTable columns={columns} data={rows} initialSort={[{ id: 'asset_tag', desc: false }]} getRowId={(r) => String(r.id)}
            emptyTitle="No assets match" emptyDescription="Try adjusting your filters or search term." minWidth={1100} />
        </>
      )}
    </div>
  )
}
