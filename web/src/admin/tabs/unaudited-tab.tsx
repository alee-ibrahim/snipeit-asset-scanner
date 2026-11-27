import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { adminApi, downloadBlob, type SnipeAssetRow, type SnipeAssetsResponse } from '@/lib/api'
import { formatDate, getStoredToken, setStoredToken } from '@/lib/helpers'
import { DataTable, SortHeader } from '../components/data-table'

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
    const text = (key: keyof SnipeAssetRow, title: string): ColumnDef<SnipeAssetRow, unknown> => ({
      accessorKey: key,
      header: ({ column }) => <SortHeader column={column} title={title} />,
      cell: ({ row }) => (row.original[key] as string) || '–',
    })
    return [
      text('asset_tag', 'Asset tag'), text('name', 'Name'), text('sap_asset_number', 'SAP #'), text('model', 'Model'),
      text('category', 'Category'), text('location', 'Location'), text('assigned_to', 'Assigned to'),
      {
        accessorKey: 'last_audit_date',
        header: ({ column }) => <SortHeader column={column} title="Last audit" />,
        cell: ({ row }) => row.original.last_audit_date ? formatDate(row.original.last_audit_date) : <Badge variant="destructive">Never</Badge>,
      },
      { accessorKey: 'next_audit_date', header: ({ column }) => <SortHeader column={column} title="Next audit" />, cell: ({ row }) => formatDate(row.original.next_audit_date) },
      text('status', 'Status'),
    ]
  }, [])

  const stats: Array<[string, number]> = data ? [
    ['Total assets', data.total],
    ['Never audited', data.never_audited.length],
    ['Not audited this year', data.not_audited_this_year.length],
    ['Audit overdue', data.audit_overdue.length],
  ] : []

  return (
    <div className="flex flex-col gap-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Snipe-IT assets</CardTitle>
          <CardDescription>Loads every asset from Snipe-IT to find ones not audited. Cached for 10 minutes.</CardDescription>
        </CardHeader>
        {!savedToken && (
          <CardContent>
            <form id="assets-form" className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void fetchAssets(false) }}>
              <Label htmlFor="assets-token">API token</Label>
              <Input id="assets-token" type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
            </form>
          </CardContent>
        )}
        <CardFooter className="gap-2">
          <Button disabled={loading} onClick={() => void fetchAssets(false)}>{loading && <Spinner />} {data ? 'Reload' : 'Fetch assets'}</Button>
          {data && <Button variant="outline" disabled={loading} onClick={() => void fetchAssets(true)}>Refresh from Snipe-IT</Button>}
        </CardFooter>
      </Card>

      {data?.cached && !loading && (
        <Alert>
          <AlertDescription>Loaded from cache ({data.cache_age} s old). Use “Refresh from Snipe-IT” for fresh data.</AlertDescription>
        </Alert>
      )}

      {loading && (
        <div className="flex flex-col gap-4" aria-busy>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
          <Skeleton className="h-64" />
        </div>
      )}

      {data && !loading && (
        <>
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
            <Input type="search" className="w-full sm:max-w-sm" placeholder="Search tag, name, SAP #, model, location" aria-label="Search assets" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <SelectTrigger aria-label="Filter assets"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(sets) as Filter[]).map((k) => <SelectItem key={k} value={k}>{sets[k].title}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">{rows.length} assets</span>
            <Button variant="outline" className="sm:ml-auto" onClick={exportCsv}>Export CSV</Button>
          </div>
          <DataTable columns={columns} data={rows} initialSort={[{ id: 'asset_tag', desc: false }]} getRowId={(r) => String(r.id)}
            emptyTitle="No assets match" emptyDescription="Try adjusting your filters or search term." minWidth={1100} />
        </>
      )}
    </div>
  )
}
