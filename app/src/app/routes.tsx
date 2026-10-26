import { Navigate, type RouteObject } from 'react-router-dom';
import AlertsPage from '@/features/alerts';
import AnalystPage from '@/features/analyst';
import ConnectionsPage from '@/features/connections';
import DashboardPage from '@/features/dashboard';
import OnboardingPage from '@/features/onboarding';
import PaperPage from '@/features/paper';
import PelosiPage from '@/features/pelosi';
import PipelinePage from '@/features/pipeline';
import SettingsPage from '@/features/settings';
import { AppShell } from './shell/AppShell';

/**
 * Route table. One folder per feature in src/features/<name>/index.tsx (default export = page).
 * Add new pages here and a nav entry in app/shell/nav.ts.
 */
export const routes: RouteObject[] = [
  { path: '/onboarding', element: <OnboardingPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'pipeline', element: <PipelinePage /> },
      { path: 'pipeline/:runId', element: <PipelinePage /> },
      { path: 'alerts', element: <AlertsPage /> },
      { path: 'paper', element: <PaperPage /> },
      { path: 'analyst', element: <AnalystPage /> },
      { path: 'pelosi', element: <PelosiPage /> },
      { path: 'connections', element: <ConnectionsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'settings/:tab', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
