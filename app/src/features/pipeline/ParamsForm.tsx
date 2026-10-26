import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { StepKey } from '@/api';
import { KeyValues } from './details/common';

export type Params = Record<string, unknown>;

/**
 * Editable parameters per step: exactly the overrides the engine accepts
 * (engine/levelset_engine/pipeline/params.py ALLOWED). Read-only outside the wizard.
 */
export function ParamsForm({
  stepKey,
  value,
  onChange,
  editable,
  setup,
}: {
  stepKey: StepKey;
  value: Params;
  onChange: (next: Params) => void;
  editable: boolean;
  setup: string;
}) {
  const { t } = useTranslation('pipeline');
  if (!editable)
    return (
      <div>
        <KeyValues data={value} empty={t('params.none')} />
        <p className="mt-3 text-xs text-text-muted">{t('params.readOnlyHint')}</p>
      </div>
    );
  const set = (k: string, v: unknown) => {
    const next = { ...value };
    if (v === '' || v === undefined || (typeof v === 'number' && Number.isNaN(v))) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const numberField = (k: string, opts: { min?: number; step?: number } = {}) => (
    <Field label={t(`params.fields.${k}`)} hint={t(`params.hints.${k}`, { defaultValue: '' })}>
      <input
        type="number"
        inputMode="decimal"
        min={opts.min}
        step={opts.step ?? 'any'}
        value={typeof value[k] === 'number' ? (value[k] as number) : ''}
        onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))}
        className={INPUT}
        name={k}
      />
    </Field>
  );
  const timeField = (k: string) => (
    <Field label={t(`params.fields.${k}`)} hint={t(`params.hints.${k}`, { defaultValue: '' })}>
      <input
        type="time"
        value={typeof value[k] === 'string' ? (value[k] as string) : ''}
        onChange={(e) => set(k, e.target.value)}
        className={INPUT}
        name={k}
      />
    </Field>
  );
  const selectField = (k: string, options: string[]) => (
    <Field label={t(`params.fields.${k}`)}>
      <select
        value={String(value[k] ?? options[0])}
        onChange={(e) => set(k, e.target.value)}
        className={INPUT}
        name={k}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {t(`params.options.${k}.${o}`, { defaultValue: o })}
          </option>
        ))}
      </select>
    </Field>
  );

  let body: ReactNode;
  switch (stepKey) {
    case 'scanner':
      body = (
        <>
          {selectField('kind', ['orb', 'daily'])}
          {timeField('at')}
          {numberField('orMinutes', { min: 5, step: 5 })}
          {numberField('minPrice', { min: 0 })}
          {numberField('minVolume', { min: 0, step: 1000 })}
        </>
      );
      break;
    case 'news':
      body = (
        <>
          {numberField('hours', { min: 1, step: 1 })}
          <Field label={t('params.fields.noSec')}>
            <input
              type="checkbox"
              checked={value.noSec === true}
              onChange={(e) => set('noSec', e.target.checked || '')}
              className="h-4 w-4 accent-primary focus-ring"
              name="noSec"
            />
          </Field>
        </>
      );
      break;
    case 'entry':
      body = (
        <>
          {numberField('orMinutes', { min: 5, step: 5 })}
          {selectField('interval', ['5m', '1m'])}
          {setup === 'level' && numberField('level', { min: 0 })}
          {numberField('minVolumeX', { min: 0, step: 0.1 })}
        </>
      );
      break;
    case 'exit':
      body = (
        <>
          <RuleField
            label={t('params.fields.stop')}
            name="stop"
            value={String(value.stop ?? 'or-mid')}
            methods={['or-mid', 'or-low', 'price', 'pct', 'atr']}
            withValue={['price', 'pct', 'atr']}
            onChange={(v) => set('stop', v)}
          />
          <RuleField
            label={t('params.fields.target')}
            name="target"
            value={String(value.target ?? '1R')}
            methods={['1R', '2R', 'price']}
            withValue={['price']}
            onChange={(v) => set('target', v)}
          />
          {timeField('flatBy')}
        </>
      );
      break;
    case 'timemachine':
      body = (
        <>
          {numberField('replays', { min: 100, step: 100 })}
          {numberField('seed', { min: 0, step: 1 })}
          {numberField('window', { min: 0, step: 1 })}
          {timeField('until')}
        </>
      );
      break;
    case 'budget':
      body = (
        <>
          <Field label={t('params.fields.limit')} hint={t('params.hints.limit')}>
            <div className="flex gap-2">
              <select
                name="limitKind"
                className={INPUT}
                value={
                  value.limit === true
                    ? 'plan'
                    : typeof value.limit === 'number'
                      ? 'price'
                      : 'market'
                }
                onChange={(e) =>
                  set(
                    'limit',
                    e.target.value === 'plan' ? true : e.target.value === 'price' ? 0 : '',
                  )
                }
              >
                {['market', 'plan', 'price'].map((o) => (
                  <option key={o} value={o}>
                    {t(`params.options.limit.${o}`)}
                  </option>
                ))}
              </select>
              {typeof value.limit === 'number' && (
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  aria-label={t('params.fields.limitPrice')}
                  value={value.limit || ''}
                  onChange={(e) => set('limit', Number(e.target.value))}
                  className={INPUT}
                />
              )}
            </div>
          </Field>
          {numberField('budget', { min: 0, step: 100 })}
        </>
      );
      break;
    default:
      body = <p className="text-sm text-text-muted">{t('params.usesSettings')}</p>;
  }
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{body}</div>;
}

const INPUT =
  'h-8 w-full min-w-0 rounded-md border border-border bg-surface2 px-2 text-sm text-text focus-ring';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-[11px]">{hint}</span>}
    </label>
  );
}

/** "or-mid" | "price:358.32" | "pct:1.5" | "atr:1.5" | "2R" as a method select + value input. */
function RuleField({
  label,
  name,
  value,
  methods,
  withValue,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  methods: string[];
  withValue: string[];
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation('pipeline');
  const [m, raw] = value.includes(':') ? value.split(':') : [value, ''];
  const method = methods.includes(m) ? m : methods[0];
  return (
    <Field label={label} hint={t(`params.hints.${name}.${method}`, { defaultValue: '' })}>
      <div className="flex gap-2">
        <select
          name={name}
          className={INPUT}
          value={method}
          onChange={(e) =>
            onChange(
              withValue.includes(e.target.value)
                ? `${e.target.value}:${raw || ''}`
                : e.target.value,
            )
          }
        >
          {methods.map((o) => (
            <option key={o} value={o}>
              {t(`params.options.${name}.${o}`, { defaultValue: o })}
            </option>
          ))}
        </select>
        {withValue.includes(method) && (
          <input
            type="number"
            step="0.01"
            min={0}
            aria-label={t(`params.valueFor.${method}`)}
            value={raw}
            onChange={(e) => onChange(`${method}:${e.target.value}`)}
            className={INPUT}
          />
        )}
      </div>
    </Field>
  );
}
