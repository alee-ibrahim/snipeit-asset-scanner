import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import ScannerApp from '@/scanner/App'
import './index.css'

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <ScannerApp />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  </StrictMode>,
)
