import { createBrowserRouter } from 'react-router-dom'
import { App } from '~/App'
import { ErrorBoundary } from '~/components/error-boundary'
import { BrowsePage } from '~/pages/browse'
import { MediaItemPage } from '~/pages/media-item'
import { PeoplePage } from '~/pages/people'
import { PersonPage } from '~/pages/person'
import { SettingsPage } from '~/pages/settings'

export const router = createBrowserRouter([
  {
    element: <App />,
    errorElement: <ErrorBoundary />,
    children: [
      { index: true, element: <BrowsePage /> },
      { path: 'browse/*', element: <BrowsePage /> },
      { path: 'media/:id', element: <MediaItemPage /> },
      { path: 'people', element: <PeoplePage /> },
      { path: 'people/:id', element: <PersonPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])
