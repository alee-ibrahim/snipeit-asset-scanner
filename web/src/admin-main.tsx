import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import AdminApp from '@/admin/App'
import './index.css'

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <AdminApp />
      <Toaster theme="light" position="bottom-center" richColors closeButton />
    </TooltipProvider>
  </StrictMode>,
)
