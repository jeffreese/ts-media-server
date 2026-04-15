import { createBrowserRouter } from 'react-router-dom'
import { App } from '~/App'
import { ErrorBoundary } from '~/components/error-boundary'
import { RequireAuth } from '~/components/require-auth'
import { AdminPage } from '~/pages/admin'
import { AdminUsersPage } from '~/pages/admin-users'
import { BrowsePage } from '~/pages/browse'
import { KeywordDetailPage } from '~/pages/keyword-detail'
import { KeywordsPage } from '~/pages/keywords'
import { LoginPage } from '~/pages/login'
import { MapPage } from '~/pages/map'
import { MediaItemPage } from '~/pages/media-item'
import { PeoplePage } from '~/pages/people'
import { FaceTriagePage } from '~/pages/face-triage'
import { PersonPage } from '~/pages/person'
import { PlacePage } from '~/pages/place'
import { PlacesPage } from '~/pages/places'
import { SearchPage } from '~/pages/search'
import { SettingsPage } from '~/pages/settings'

export const router = createBrowserRouter([
  {
    path: 'login',
    element: <LoginPage />,
    errorElement: <ErrorBoundary />,
  },
  {
    element: <RequireAuth />,
    errorElement: <ErrorBoundary />,
    children: [
      {
        element: <App />,
        errorElement: <ErrorBoundary />,
        children: [
          { index: true, element: <BrowsePage /> },
          { path: 'browse/*', element: <BrowsePage /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'media/:id', element: <MediaItemPage /> },
          { path: 'keywords', element: <KeywordsPage /> },
          { path: 'keywords/:id', element: <KeywordDetailPage /> },
          { path: 'people', element: <PeoplePage /> },
          { path: 'people/triage', element: <FaceTriagePage /> },
          { path: 'people/:id', element: <PersonPage /> },
          { path: 'places', element: <PlacesPage /> },
          { path: 'places/:id', element: <PlacePage /> },
          { path: 'map', element: <MapPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'admin', element: <AdminPage /> },
          { path: 'admin/users', element: <AdminUsersPage /> },
        ],
      },
    ],
  },
])
