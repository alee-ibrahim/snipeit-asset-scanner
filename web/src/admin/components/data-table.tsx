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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** Sortable column header (shadcn data-table pattern). */
export function SortHeader<T>({ column, title }: { column: Column<T, unknown>; title: string }) {
  const dir = column.getIsSorted()
  return (
    <Button variant="ghost" size="sm" onClick={() => column.toggleSorting(dir === 'asc')}>
      {title}
      {dir === 'asc' ? <ArrowUpIcon /> : dir === 'desc' ? <ArrowDownIcon /> : <ArrowUpDownIcon />}
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
    <div className="rounded-md border">
      <Table style={{ minWidth }}>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableHead key={h.id}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          )) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                {emptyTitle}{emptyDescription ? `. ${emptyDescription}` : ''}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
