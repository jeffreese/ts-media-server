import { Wifi, WifiOff } from 'lucide-react'
import { useNotifications } from '~/hooks/use-notifications'

export function ConnectionStatus() {
  const { status } = useNotifications()

  if (status === 'connected') return null

  return (
    <div
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
      title={status === 'connecting' ? 'Connecting to server…' : 'Disconnected from server'}
    >
      {status === 'connecting' ? (
        <>
          <Wifi className="h-3.5 w-3.5 text-warning" />
          <span className="text-warning">Connecting…</span>
        </>
      ) : (
        <>
          <WifiOff className="h-3.5 w-3.5 text-error" />
          <span className="text-error">Disconnected</span>
        </>
      )}
    </div>
  )
}
