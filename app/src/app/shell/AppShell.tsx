import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getEngineInfo, useEngineEvents, useStatus } from '@/api';
import { DisclaimerBanner } from '@/components/Disclaimer';
import { ErrorState } from '@/components/ErrorState';
import { useAlertNotifications } from '@/features/alerts/notifications';
import { useUiStore } from '../uiStore';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';

/** Global frame: sidebar + status bar + page outlet + disclaimer banner. */
export function AppShell() {
  const { t } = useTranslation('shell');
  const onboardingDone = useUiStore((s) => s.onboardingDone);
  const location = useLocation();
  const status = useStatus();
  useEngineEvents();
  useAlertNotifications();

  if (!onboardingDone)
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;

  const offline = status.isError && !status.data;

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg text-text">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-primary px-3 py-2 text-on-primary focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
      >
        {t('skipToContent')}
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <StatusBar />
        {offline && (
          <div className="border-b border-border px-6 py-3">
            <ErrorState
              compact
              title={t('engine.offlineTitle')}
              error={status.error}
              onRetry={() => void status.refetch()}
              retrying={status.isFetching}
            />
            <p className="mt-1 px-1 text-xs text-text-muted">
              {t('engine.offlineHint', { url: getEngineInfo().url })}
            </p>
          </div>
        )}
        <main
          id="main"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-5 focus:outline-none"
        >
          <Outlet />
        </main>
        <DisclaimerBanner dataDelaySeconds={status.data?.dataDelaySeconds} />
      </div>
    </div>
  );
}
