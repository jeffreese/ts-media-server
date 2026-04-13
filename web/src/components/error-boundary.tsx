import { AlertTriangle } from 'lucide-react'
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'

export function ErrorBoundary() {
  const error = useRouteError()
  const navigate = useNavigate()

  let title = 'Something went wrong'
  let message = 'An unexpected error occurred.'

  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? 'Page not found' : `Error ${error.status}`
    message =
      error.status === 404
        ? "The page you're looking for doesn't exist."
        : error.statusText || message
  } else if (error instanceof Error) {
    message = error.message
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertTriangle className="h-12 w-12 text-warning" />
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-foreground-muted">{message}</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-foreground"
        >
          Go home
        </button>
      </div>
    </div>
  )
}
