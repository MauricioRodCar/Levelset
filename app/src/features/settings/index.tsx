import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Bot, Database, Info, Languages, Palette, Wallet, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AboutTab } from './tabs/AboutTab';
import { AccountLimitsTab } from './tabs/AccountLimitsTab';
import { AiTab } from './tabs/AiTab';
import { AppearanceTab } from './tabs/AppearanceTab';
import { DataSecTab } from './tabs/DataSecTab';
import { LanguageTab } from './tabs/LanguageTab';

const SETTINGS_TABS = ['account', 'appearance', 'language', 'data', 'ai', 'about'] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

const TABS: Record<SettingsTab, { icon: LucideIcon; Component: () => JSX.Element }> = {
  account: { icon: Wallet, Component: AccountLimitsTab },
  appearance: { icon: Palette, Component: AppearanceTab },
  language: { icon: Languages, Component: LanguageTab },
  data: { icon: Database, Component: DataSecTab },
  ai: { icon: Bot, Component: AiTab },
  about: { icon: Info, Component: AboutTab },
};

/** Settings shell. Tab is part of the URL: /settings/:tab (default: account). */
export default function SettingsPage() {
  const { t } = useTranslation('settings');
  const { tab } = useParams();
  const navigate = useNavigate();
  if (tab && !(SETTINGS_TABS as readonly string[]).includes(tab))
    return <Navigate to="/settings" replace />;
  const current = (tab as SettingsTab) ?? 'account';

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs value={current} onValueChange={(v) => navigate(`/settings/${v}`)}>
        <TabsList className="w-full flex-wrap justify-start">
          {SETTINGS_TABS.map((key) => {
            const Icon = TABS[key].icon;
            return (
              <TabsTrigger key={key} value={key}>
                <Icon className="h-4 w-4" aria-hidden />
                {t(`tabs.${key}`)}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {SETTINGS_TABS.map((key) => {
          const { Component } = TABS[key];
          return (
            <TabsContent key={key} value={key}>
              <Component />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
