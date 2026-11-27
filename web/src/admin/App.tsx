import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
            <CardTitle>Admin dashboard</CardTitle>
            <CardDescription>Enter the admin password to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form id="login-form" className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void login() }}>
              <Label htmlFor="admin-password">Password</Label>
              <Input id="admin-password" type="password" autoComplete="current-password" value={pwInput}
                onChange={(e) => setPwInput(e.target.value)} aria-invalid={loginError || undefined} />
              {loginError && <p className="text-sm text-destructive" role="alert">Wrong password. Try again.</p>}
            </form>
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button type="submit" form="login-form" disabled={loggingIn} className="w-full">{loggingIn && <Spinner />} Log in</Button>
            <Button asChild variant="outline" className="w-full"><a href="/">Back to scanner</a></Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2">
          <span className="mr-auto truncate font-semibold">Audit Dashboard</span>
          <Button asChild variant="ghost"><a href="/">Scanner</a></Button>
          <Button variant="outline" onClick={() => void exportExcel()}>Export Excel</Button>
          <Button variant="ghost" onClick={logout}>Log out</Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4">
        <Tabs defaultValue="audits">
          <TabsList>
            <TabsTrigger value="audits">Audits ({audits.length})</TabsTrigger>
            <TabsTrigger value="noqr">No-QR ({manual.length})</TabsTrigger>
            <TabsTrigger value="unaudited">Unaudited</TabsTrigger>
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
