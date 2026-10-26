import { useRef, useState, type ChangeEvent } from 'react';
import { Download, Pencil, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import {
  exportThemeJson,
  themeName,
  useActiveTheme,
  useAllThemes,
  useThemeStore,
  type TokenKey,
} from '@/theme';
import { ContrastWarnings } from '../appearance/ContrastWarnings';
import { SampleKpi, SampleTicketCard } from '../appearance/SampleTicketCard';
import { ThemeThumb } from '../appearance/ThemeThumb';
import { TokenEditor } from '../appearance/TokenEditor';

type NameDialog = { mode: 'saveAs' | 'rename'; value: string } | null;

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'theme';

/** Settings > Appearance: presets, per-token pickers, live preview, contrast check, save/import/export. */
export function AppearanceTab() {
  const { t, i18n } = useTranslation('settings');
  const theme = useActiveTheme();
  const { presets, custom } = useAllThemes();
  const store = useThemeStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const name = themeName(theme, i18n.language);

  /** Editing a preset forks it into a custom theme first (presets are read-only). */
  const onTokenChange = (token: TokenKey, hex: string) => {
    let id = theme.id;
    if (!theme.custom) {
      id = store.createFrom(theme.id, t('appearance.copyName', { name }));
      toast(t('appearance.forked', { name }));
    }
    useThemeStore.getState().setToken(id, token, hex);
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const res = store.importJson(await file.text());
    if (res.ok) toast(t('appearance.imported', { name: themeName(res.theme, i18n.language) }));
    else toast.error(t(`appearance.importErrors.${res.error}`, { token: res.detail ?? '' }));
  };

  const submitName = () => {
    if (!nameDialog) return;
    const value = nameDialog.value.trim();
    if (!value) return;
    if (nameDialog.mode === 'saveAs') {
      store.createFrom(theme.id, value);
      toast(t('appearance.saved', { name: value }));
    } else {
      store.rename(theme.id, value);
    }
    setNameDialog(null);
  };

  return (
    <div className="space-y-5">
      <Card title={t('appearance.presets')} subtitle={t('appearance.presetsHint')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {presets.map((p) => (
            <ThemeThumb
              key={p.id}
              theme={p}
              active={p.id === theme.id}
              onSelect={() => store.setActive(p.id)}
            />
          ))}
        </div>
        {custom.length > 0 && (
          <>
            <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t('appearance.yourThemes')}
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
              {custom.map((c) => (
                <ThemeThumb
                  key={c.id}
                  theme={c}
                  active={c.id === theme.id}
                  onSelect={() => store.setActive(c.id)}
                />
              ))}
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card
          title={t('appearance.colours', { name })}
          subtitle={theme.custom ? t('appearance.customHint') : t('appearance.presetHint')}
        >
          <TokenEditor theme={theme} onChange={onTokenChange} />
        </Card>

        <div className="space-y-5">
          <Card title={t('appearance.preview')} subtitle={t('appearance.previewHint')}>
            <div className="space-y-3">
              <SampleTicketCard />
              <SampleKpi />
            </div>
          </Card>
          <Card title={t('appearance.contrast.title')}>
            <ContrastWarnings tokens={theme.tokens} />
          </Card>
          <Card title={t('appearance.manage')}>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  setNameDialog({ mode: 'saveAs', value: t('appearance.copyName', { name }) })
                }
              >
                <Save aria-hidden />
                {t('appearance.actions.saveAs')}
              </Button>
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <Upload aria-hidden />
                {t('appearance.actions.import')}
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  download(`levelset-theme-${slug(name)}.json`, exportThemeJson(theme))
                }
              >
                <Download aria-hidden />
                {t('appearance.actions.export')}
              </Button>
              <Button
                size="sm"
                disabled={!theme.custom}
                onClick={() => setNameDialog({ mode: 'rename', value: name })}
              >
                <Pencil aria-hidden />
                {t('appearance.actions.rename')}
              </Button>
              <Button
                size="sm"
                disabled={!theme.custom}
                onClick={() => {
                  store.reset(theme.id);
                  toast(t('appearance.resetDone'));
                }}
              >
                <RotateCcw aria-hidden />
                {t('appearance.actions.reset')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={!theme.custom}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden />
                {t('appearance.actions.delete')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={onImport}
                aria-hidden
                tabIndex={-1}
              />
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={!!nameDialog} onOpenChange={(o) => !o && setNameDialog(null)}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitName();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {nameDialog?.mode === 'rename'
                  ? t('appearance.actions.rename')
                  : t('appearance.actions.saveAs')}
              </DialogTitle>
              <DialogDescription>{t('appearance.nameHint')}</DialogDescription>
            </DialogHeader>
            <Label htmlFor="theme-name">{t('appearance.name')}</Label>
            <Input
              id="theme-name"
              className="mt-1.5"
              autoFocus
              value={nameDialog?.value ?? ''}
              onChange={(e) => setNameDialog((d) => (d ? { ...d, value: e.target.value } : d))}
              maxLength={40}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{t('common:actions.cancel')}</Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={!nameDialog?.value.trim()}>
                {t('common:actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('appearance.deleteTitle', { name })}</DialogTitle>
            <DialogDescription>{t('appearance.deleteHint')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                store.remove(theme.id);
                setConfirmDelete(false);
              }}
            >
              <Trash2 aria-hidden />
              {t('appearance.actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
