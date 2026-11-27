import { useCallback, useEffect, useState } from 'react'
import { CameraIcon, DownloadIcon, LogOutIcon, ScanLineIcon, ShieldIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConfirm } from '@/hooks/use-confirm'
import { adminApi, ApiError, downloadBlob, type AuditRecord, type ManualAsset } from '@/lib/api'
import { getStoredToken } from '@/lib/helpers'
import { AuditsTab } from './tabs/audits-tab'
import { NoQrTab } from './tabs/noqr-tab'
import { UnauditedTab } from './tabs/unaudited-tab'

export default function AdminApp() {
  const [password, setPassword] = useState(() => sessionStorage.getItem('admin_password') || '')
  const [pwInput, setPwInput] = useState('')
  const [loginError, setLoginError] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [audits, setAudits] = useState<AuditRecord[]>([])
  const [manual, setManual] = useState<ManualAsset[]>([])
  const [resolveToken, setResolveToken] = useState(() => getStoredToken('audit_snipeit_token') || '')
  const { confirm, dialog } = useConfirm()

  const logout = useCallback(() => {
    sessionStorage.removeItem('admin_password')
    setPassword('')
  }, [])

  const loadAudits = useCallback(async () => {
    try {
      setAudits(await adminApi.audits(password))
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) logout()
      else toast.error('Could not load audits')
    }
  }, [password, logout])

  const loadManual = useCallback(async () => {
    try {
      setManual(await adminApi.manualAssets(password))
    } catch {
      toast.error('Could not load no-QR records')
    }
  }, [password])

  useEffect(() => {
    if (!password) return
    void loadAudits()
    void loadManual()
  }, [password, loadAudits, loadManual])

  const login = async () => {
    setLoggingIn(true)
    try {
      await adminApi.verify(pwInput)
      sessionStorage.setItem('admin_password', pwInput)
      setPassword(pwInput)
      setLoginError(false)
    } catch {
      setLoginError(true)
    } finally {
      setLoggingIn(false)
    }
  }

  const exportExcel = async () => {
    try {
      downloadBlob(await adminApi.exportAll(password), 'audit_report.xlsx')
    } catch {
      toast.error('Failed to export')
    }
  }

  if (!password) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><ShieldIcon className="size-6" /></div>
            <CardTitle className="text-xl font-bold">Admin dashboard</CardTitle>
            <CardDescription>Enter the admin password to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form id="login-form" onSubmit={(e) => { e.preventDefault(); void login() }}>
              <Field data-invalid={loginError || undefined}>
                <FieldLabel htmlFor="admin-password">Password</FieldLabel>
                <Input id="admin-password" type="password" autoComplete="current-password" className="h-11" value={pwInput}
                  onChange={(e) => setPwInput(e.target.value)} aria-invalid={loginError || undefined} />
                {loginError && <FieldError>Wrong password. Try again.</FieldError>}
              </Field>
            </form>
          </CardContent>
          <CardFooter className="flex-col gap-2 border-t-0 bg-transparent">
            <Button type="submit" form="login-form" size="touch-lg" disabled={loggingIn} className="w-full">{loggingIn && <Spinner />} Log in</Button>
            <Button asChild variant="ghost" size="touch" className="w-full"><a href="/">Back to scanner</a></Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 flex items-center gap-2 bg-primary px-3 pt-[calc(env(safe-area-inset-top)+0.375rem)] pb-1.5 text-primary-foreground sm:px-6 sm:py-2.5">
        <ScanLineIcon className="size-6" aria-hidden />
        <span className="mr-auto text-base font-bold sm:text-lg">Audit Dashboard</span>
        <Button asChild variant="ghost" size="touch" className="text-primary-foreground hover:bg-white/15 hover:text-primary-foreground max-sm:w-11 max-sm:px-0" aria-label="Scanner">
          <a href="/"><CameraIcon /><span className="max-sm:hidden">Scanner</span></a>
        </Button>
        <Button size="touch" onClick={() => void exportExcel()} aria-label="Export Excel" className="bg-success text-success-foreground hover:bg-success/90 max-sm:w-11 max-sm:px-0">
          <DownloadIcon /><span className="max-sm:hidden">Export Excel</span>
        </Button>
        <Button variant="ghost" size="icon-touch" aria-label="Log out" onClick={logout} className="text-primary-foreground hover:bg-white/15 hover:text-primary-foreground">
          <LogOutIcon />
        </Button>
      </header>

      <main className="mx-auto max-w-[1440px] p-3 sm:p-6">
        <Tabs defaultValue="audits" className="gap-3 sm:gap-4">
          <TabsList className="h-11! w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="audits" className="h-9 px-3">Audits <Badge variant="secondary" className="ml-1 tabular-nums">{audits.length}</Badge></TabsTrigger>
            <TabsTrigger value="noqr" className="h-9 px-3">No-QR <Badge variant="secondary" className="ml-1 tabular-nums">{manual.length}</Badge></TabsTrigger>
            <TabsTrigger value="unaudited" className="h-9 px-3">Unaudited</TabsTrigger>
          </TabsList>
          <TabsContent value="audits">
            <AuditsTab password={password} audits={audits} reload={loadAudits} resolveToken={resolveToken} setResolveToken={setResolveToken} confirm={confirm} />
          </TabsContent>
          <TabsContent value="noqr">
            <NoQrTab password={password} records={manual} reload={loadManual} confirm={confirm} />
          </TabsContent>
          <TabsContent value="unaudited">
            <UnauditedTab password={password} />
          </TabsContent>
        </Tabs>
      </main>
      {dialog}
    </div>
  )
}
