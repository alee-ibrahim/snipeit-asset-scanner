import { useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type OnChangeFn,
  type Row,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/** Sortable column header (shadcn data-table pattern). */
export function SortHeader<T>({ column, title }: { column: Column<T, unknown>; title: string }) {
  const dir = column.getIsSorted()
  return (
    <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-xs font-semibold tracking-wide uppercase" onClick={() => column.toggleSorting(dir === 'asc')}>
      {title}
      {dir === 'asc' ? <ArrowUpIcon /> : dir === 'desc' ? <ArrowDownIcon /> : <ArrowUpDownIcon className="opacity-50" />}
    </Button>
  )
}

interface Props<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  initialSort?: SortingState
  emptyTitle: string
  emptyDescription?: string
  getRowId?: (row: T) => string
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  enableRowSelection?: (row: Row<T>) => boolean
  minWidth?: number
}

export function DataTable<T>({
  columns, data, initialSort = [], emptyTitle, emptyDescription, getRowId,
  rowSelection, onRowSelectionChange, enableRowSelection, minWidth = 960,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort)
  const table = useReactTable({
    data,
    columns,
    state: { sorting, ...(rowSelection ? { rowSelection } : {}) },
    onSortingChange: setSorting,
    onRowSelectionChange,
    enableRowSelection: enableRowSelection ?? false,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="max-h-[calc(100dvh-18rem)] overflow-auto max-sm:max-h-none">
        <Table style={{ minWidth }}>
          <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="h-10 px-2.5 text-xs font-semibold text-muted-foreground uppercase sm:px-3">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cn('px-2.5 py-2 text-[13px] sm:px-3 sm:text-sm')}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.length === 0 && (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              {emptyDescription && <EmptyDescription>{emptyDescription}</EmptyDescription>}
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}
