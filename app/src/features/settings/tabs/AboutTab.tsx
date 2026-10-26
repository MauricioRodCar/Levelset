import { ExternalLink, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStatus } from '@/api';
import { useUiStore } from '@/app/uiStore';
import { Card } from '@/components/Card';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';
import { DAY_TRADER_SKILL_LICENSE, DAY_TRADER_SKILL_URL } from '../licenses';

/** Settings > About: versions, tier, licences (MIT notice for day-trader-skill). */
export function AboutTab() {
  const { t } = useTranslation('settings');
  const { data: status } = useStatus();
  const resetOnboarding = useUiStore((s) => s.resetOnboarding);
  const navigate = useNavigate();
  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card title={t('about.title')}>
        <dl className="tabular grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-text-muted">{t('about.appVersion')}</dt>
          <dd className="text-text">{env.appVersion}</dd>
          <dt className="text-text-muted">{t('about.engineVersion')}</dt>
          <dd className="text-text">{status?.engineVersion ?? '—'}</dd>
          <dt className="text-text-muted">{t('about.mode')}</dt>
          <dd className="text-text">{status ? t(`about.modes.${status.mode}`) : '—'}</dd>
          <dt className="text-text-muted">{t('about.tier')}</dt>
          <dd className="text-text">{status ? t(`shell:tiers.${status.tier}`) : '—'}</dd>
          <dt className="text-text-muted">{t('about.license')}</dt>
          <dd className="text-text">{t('about.licenseValue')}</dd>
        </dl>
        <p className="mt-4 text-xs text-text-muted">{t('about.notAdvice')}</p>
        <Button
          size="sm"
          className="mt-4"
          onClick={() => {
            resetOnboarding();
            navigate('/onboarding');
          }}
        >
          <RotateCcw aria-hidden />
          {t('about.rerunSetup')}
        </Button>
      </Card>
      <Card
        title={t('about.thirdParty')}
        subtitle={t('about.thirdPartyHint')}
        actions={
          <Button asChild size="sm" variant="link">
            <a href={DAY_TRADER_SKILL_URL} target="_blank" rel="noreferrer">
              day-trader-skill
              <ExternalLink aria-hidden />
            </a>
          </Button>
        }
      >
        {/* Licence text is legal content and stays in its original English. */}
        <pre
          lang="en"
          className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-text-muted"
        >
          {DAY_TRADER_SKILL_LICENSE}
        </pre>
      </Card>
    </div>
  );
}
