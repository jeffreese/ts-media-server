import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { WebSocketProvider } from '~/hooks/use-notifications'
import { ThemeProvider } from '~/hooks/use-theme'
import { router } from '~/router'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <WebSocketProvider>
        <RouterProvider router={router} />
      </WebSocketProvider>
    </ThemeProvider>
  </StrictMode>,
)
