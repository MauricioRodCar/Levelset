import { useEffect, useMemo, useState } from 'react';
import { Info, Plus, Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  BRIDGE_PLATFORMS,
  useSaveSymbolMap,
  useSymbolMap,
  type BridgePlatform,
  type SymbolMapRow,
} from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import {
  NUMBER_FIELDS,
  useBridgeErrorMessage,
  validateRows,
  type DraftRow,
  type Field,
} from './bridgeUi';

let nextKey = 1;
const toDraft = (r: SymbolMapRow): DraftRow => ({
  key: nextKey++,
  platform: r.platform,
  usSymbol: r.usSymbol,
  brokerSymbol: r.brokerSymbol,
  volumePerShare: String(r.volumePerShare),
  minVolume: String(r.minVolume),
  volumeStep: String(r.volumeStep),
});

const DEFAULTS: Record<BridgePlatform, Pick<DraftRow, (typeof NUMBER_FIELDS)[number]>> = {
  ctrader: { volumePerShare: '1', minVolume: '1', volumeStep: '1' },
  mt4: { volumePerShare: '0.01', minVolume: '0.01', volumeStep: '0.01' },
  mt5: { volumePerShare: '0.01', minVolume: '0.01', volumeStep: '0.01' },
};

export function SymbolMapEditor() {
  const { t } = useTranslation('connections');
  const map = useSymbolMap();
  const save = useSaveSymbolMap();
  const errorMessage = useBridgeErrorMessage();
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (map.data && rows === null) setRows(map.data.rows.map(toDraft));
  }, [map.data, rows]);

  const errors = useMemo(() => validateRows(rows ?? []), [rows]);
  const dirty = useMemo(() => {
    if (!rows || !map.data) return false;
    const norm = (rs: Omit<DraftRow, 'key'>[] | SymbolMapRow[]) =>
      JSON.stringify(
        rs.map((r) => [
          r.platform,
          r.usSymbol,
          r.brokerSymbol,
          String(r.volumePerShare),
          String(r.minVolume),
          String(r.volumeStep),
        ]),
      );
    return norm(rows) !== norm(map.data.rows);
  }, [rows, map.data]);

  if (map.isError) return <ErrorState error={map.error} onRetry={map.refetch} />;

  const update = (key: number, patch: Partial<DraftRow>) =>
    setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const add = () =>
    setRows((rs) => [
      ...(rs ?? []),
      { key: nextKey++, platform: 'ctrader', usSymbol: '', brokerSymbol: '', ...DEFAULTS.ctrader },
    ]);

  const remove = (key: number) => setRows((rs) => (rs ?? []).filter((r) => r.key !== key));

  const submit = () => {
    if (!rows) return;
    if (errors.some((e) => Object.keys(e).length)) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    const body = {
      rows: rows.map((r) => ({
        platform: r.platform,
        usSymbol: r.usSymbol.trim().toUpperCase(),
        brokerSymbol: r.brokerSymbol.trim(),
        volumePerShare: Number(r.volumePerShare.replace(',', '.')),
        minVolume: Number(r.minVolume.replace(',', '.')),
        volumeStep: Number(r.volumeStep.replace(',', '.')),
      })),
    };
    save.mutate(body, {
      onSuccess: (data) => {
        setRows(data.rows.map(toDraft));
        toast(t('bridges.map.saved'));
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const cols: { field: Field; label: string; numeric?: boolean }[] = [
    { field: 'usSymbol', label: t('bridges.map.usSymbol') },
    { field: 'brokerSymbol', label: t('bridges.map.brokerSymbol') },
    { field: 'volumePerShare', label: t('bridges.map.volumePerShare'), numeric: true },
    { field: 'minVolume', label: t('bridges.map.minVolume'), numeric: true },
    { field: 'volumeStep', label: t('bridges.map.volumeStep'), numeric: true },
  ];

  return (
    <Card
      title={t('bridges.map.title')}
      subtitle={t('bridges.map.intro')}
      actions={
        dirty ? <span className="text-xs text-text-muted">{t('bridges.map.unsaved')}</span> : null
      }
      flush
    >
      {!rows ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : (
        <div className="px-4 pb-4">
          <p className="mb-3 flex items-start gap-1.5 text-xs text-text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('bridges.map.lotsHint')}
          </p>
          {rows.length === 0 ? (
            <p className="rounded-md bg-surface2 px-3 py-4 text-sm text-text-muted">
              {t('bridges.map.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-muted">
                    <th scope="col" className="pb-2 pr-2 font-medium">
                      {t('bridges.map.platform')}
                    </th>
                    {cols.map((c) => (
                      <th key={c.field} scope="col" className="pb-2 pr-2 font-medium">
                        {c.label}
                      </th>
                    ))}
                    <th scope="col" className="sr-only">
                      {t('bridges.map.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.key} className="align-top" data-testid="symbol-row">
                      <td className="py-1 pr-2">
                        <Select
                          aria-label={`${t('bridges.map.platform')} ${i + 1}`}
                          value={r.platform}
                          onChange={(e) => {
                            const p = e.target.value as BridgePlatform;
                            update(r.key, { platform: p });
                          }}
                        >
                          {BRIDGE_PLATFORMS.map((p) => (
                            <option key={p} value={p}>
                              {t(`platforms.${p}.name`)}
                            </option>
                          ))}
                        </Select>
                      </td>
                      {cols.map((c) => {
                        const err = showErrors ? errors[i]?.[c.field] : undefined;
                        const errId = `map-${r.key}-${c.field}-err`;
                        return (
                          <td key={c.field} className="py-1 pr-2">
                            <Input
                              aria-label={`${c.label} ${i + 1}`}
                              value={r[c.field]}
                              inputMode={c.numeric ? 'decimal' : undefined}
                              className={
                                c.numeric
                                  ? 'tabular'
                                  : c.field === 'usSymbol'
                                    ? 'uppercase'
                                    : undefined
                              }
                              aria-invalid={err ? true : undefined}
                              aria-describedby={err ? errId : undefined}
                              onChange={(e) => update(r.key, { [c.field]: e.target.value })}
                            />
                            {err && (
                              <p id={errId} className="mt-0.5 text-xs text-text">
                                {t(`bridges.map.errors.${err}`)}
                              </p>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('bridges.map.delete', { n: i + 1 })}
                          onClick={() => remove(r.key)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={add}>
              <Plus aria-hidden />
              {t('bridges.map.add')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={submit}
              disabled={!dirty || save.isPending}
            >
              <Save aria-hidden />
              {t('bridges.map.save')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
