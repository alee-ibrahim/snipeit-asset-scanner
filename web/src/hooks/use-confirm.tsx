import { useCallback, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ConfirmOptions {
  title: string
  description: string
  confirmLabel?: string
  destructive?: boolean
}

/** Promise-based confirm built on shadcn AlertDialog: `if (await confirm({...})) ...` */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<(v: boolean) => void>(() => {})

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => { resolver.current = resolve })
  }, [])

  const close = (value: boolean) => {
    resolver.current(value)
    setOpts(null)
  }

  const dialog = (
    <AlertDialog open={!!opts} onOpenChange={(open) => { if (!open) close(false) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          <AlertDialogDescription>{opts?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={opts?.destructive === false ? 'default' : 'destructive'} onClick={() => close(true)}>
            {opts?.confirmLabel ?? 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirm, dialog }
}
