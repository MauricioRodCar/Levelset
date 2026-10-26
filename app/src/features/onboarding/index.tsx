import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, LayoutDashboard, Loader2, PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStartRun } from '@/api';
import { useUiStore } from '@/app/uiStore';
import { Logo } from '@/app/shell/Logo';
import { DisclaimerText } from '@/components/Disclaimer';
import { Button } from '@/components/ui/button';
import { Checkbox, Label } from '@/components/ui/form';
import { LANGUAGES, setLanguage, type Language } from '@/i18n';
import { cn } from '@/lib/utils';
import { PRESETS, useActiveTheme, useThemeStore } from '@/theme';
import { AccountLimitsForm } from '@/features/settings/components/AccountLimitsForm';
import { ThemeThumb } from '@/features/settings/appearance/ThemeThumb';

const STEPS = ['language', 'theme', 'account', 'disclaimer', 'finish'] as const;
type StepKey = (typeof STEPS)[number];

function Stepper({ current }: { current: number }) {
  const { t } = useTranslation('onboarding');
  return (
    <ol
      className="flex items-center gap-2"
      aria-label={t('progress', { current: current + 1, total: STEPS.length })}
    >
      {STEPS.map((s, i) => (
        <li
          key={s}
          className="flex items-center gap-2"
          aria-current={i === current ? 'step' : undefined}
        >
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold tabular',
              i < current && 'border-primary bg-primary text-on-primary',
              i === current && 'border-primary text-text',
              i > current && 'border-border text-text-muted',
            )}
          >
            {i < current ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
          </span>
          <span
            className={cn(
              'hidden text-xs md:inline',
              i === current ? 'text-text' : 'text-text-muted',
            )}
          >
            {t(`steps.${s}.short`)}
          </span>
          {i < STEPS.length - 1 && <span aria-hidden className="h-px w-6 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

/** First-run wizard: language -> theme -> account & limits -> disclaimer -> start. */
export default function OnboardingPage() {
  const { t, i18n } = useTranslation('onboarding');
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const theme = useActiveTheme();
  const setActive = useThemeStore((s) => s.setActive);
  const { completeOnboarding, acceptDisclaimer } = useUiStore.getState();
  const startRun = useStartRun();
  const step: StepKey = STEPS[index];
  const lang = i18n.language.slice(0, 2) as Language;

  const next = () => setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const back = () => setIndex((i) => Math.max(i - 1, 0));

  const finish = async (demo: boolean) => {
    completeOnboarding();
    if (!demo) return navigate('/', { replace: true });
    try {
      const run = await startRun.mutateAsync({ mode: 'all', ticker: 'TSLA', setup: 'orb' });
      navigate(`/pipeline/${run.id}`, { replace: true });
    } catch {
      navigate('/pipeline', { replace: true });
    }
  };

  return (
    <div className="flex min-h-full items-start justify-center overflow-y-auto bg-bg px-4 py-10 text-text">
      <div className="w-full max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Logo className="h-8 w-8" />
            <span className="text-lg font-semibold">Levelset</span>
          </div>
          <Stepper current={index} />
        </div>

        <section
          className="rounded-xl border border-border bg-surface p-6 shadow-sm"
          aria-labelledby="ob-title"
        >
          <h1 id="ob-title" className="text-xl font-semibold">
            {t(`steps.${step}.title`)}
          </h1>
          <p className="mt-1 text-sm text-text-muted">{t(`steps.${step}.description`)}</p>

          <div className="mt-6">
            {step === 'language' && (
              <div
                role="radiogroup"
                aria-label={t('steps.language.title')}
                className="grid gap-3 sm:grid-cols-2"
              >
                {LANGUAGES.map((lng) => (
                  <button
                    key={lng}
                    type="button"
                    role="radio"
                    aria-checked={lang === lng}
                    lang={lng}
                    onClick={() => void setLanguage(lng)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-4 py-4 text-left focus-ring',
                      lang === lng
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:bg-surface2',
                    )}
                  >
                    <span className="text-sm font-semibold uppercase text-text-muted">{lng}</span>
                    <span className="flex-1 text-base font-medium">
                      {t(`common:language.names.${lng}`)}
                    </span>
                    {lang === lng && <Check className="h-4 w-4 text-primary" aria-hidden />}
                  </button>
                ))}
              </div>
            )}

            {step === 'theme' && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {PRESETS.map((p) => (
                  <ThemeThumb
                    key={p.id}
                    theme={p}
                    active={p.id === theme.id}
                    onSelect={() => setActive(p.id)}
                  />
                ))}
              </div>
            )}

            {step === 'account' && (
              <AccountLimitsForm
                submitLabel={t('saveAndContinue')}
                onSaved={next}
                extraActions={
                  <>
                    <Button variant="ghost" onClick={back}>
                      <ArrowLeft aria-hidden />
                      {t('back')}
                    </Button>
                    <Button variant="outline" onClick={next}>
                      {t('skip')}
                    </Button>
                  </>
                }
              />
            )}

            {step === 'disclaimer' && (
              <div className="space-y-5">
                <div className="rounded-lg border border-border bg-bg p-4">
                  <DisclaimerText />
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="ob-accept"
                    checked={accepted}
                    onCheckedChange={(v) => setAccepted(v === true)}
                  />
                  <Label htmlFor="ob-accept" className="leading-snug">
                    {t('steps.disclaimer.accept')}
                  </Label>
                </div>
              </div>
            )}

            {step === 'finish' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void finish(true)}
                  disabled={startRun.isPending}
                  className="flex flex-col items-start gap-2 rounded-lg border border-primary bg-primary/10 p-5 text-left focus-ring disabled:opacity-60"
                >
                  {startRun.isPending ? (
                    <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
                  ) : (
                    <PlayCircle className="h-6 w-6 text-primary" aria-hidden />
                  )}
                  <span className="text-base font-semibold">{t('steps.finish.demo')}</span>
                  <span className="text-sm text-text-muted">{t('steps.finish.demoHint')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void finish(false)}
                  className="flex flex-col items-start gap-2 rounded-lg border border-border p-5 text-left hover:bg-surface2 focus-ring"
                >
                  <LayoutDashboard className="h-6 w-6 text-text-muted" aria-hidden />
                  <span className="text-base font-semibold">{t('steps.finish.dashboard')}</span>
                  <span className="text-sm text-text-muted">{t('steps.finish.dashboardHint')}</span>
                </button>
              </div>
            )}
          </div>

          {step !== 'account' && step !== 'finish' && (
            <div className="mt-8 flex justify-between">
              <Button variant="ghost" onClick={back} disabled={index === 0}>
                <ArrowLeft aria-hidden />
                {t('back')}
              </Button>
              <Button
                variant="primary"
                disabled={step === 'disclaimer' && !accepted}
                onClick={() => {
                  if (step === 'disclaimer') acceptDisclaimer();
                  next();
                }}
              >
                {step === 'disclaimer' ? t('steps.disclaimer.continue') : t('next')}
                <ArrowRight aria-hidden />
              </Button>
            </div>
          )}
          {step === 'finish' && (
            <div className="mt-6">
              <Button variant="ghost" onClick={back}>
                <ArrowLeft aria-hidden />
                {t('back')}
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
