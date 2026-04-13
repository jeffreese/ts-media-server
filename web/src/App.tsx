import { Outlet } from 'react-router-dom'
import { Sidebar } from '~/components/sidebar'
import { Topbar } from '~/components/topbar'

export function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
