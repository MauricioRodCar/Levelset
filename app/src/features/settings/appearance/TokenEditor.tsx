import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isHexColor, TOKEN_CSS_NAME, type Theme, type TokenKey } from '@/theme';

const TOKEN_GROUPS: { key: string; tokens: TokenKey[] }[] = [
  { key: 'surfaces', tokens: ['bg', 'surface', 'surface2', 'border'] },
  { key: 'text', tokens: ['text', 'textMuted'] },
  { key: 'actions', tokens: ['primary', 'onPrimary', 'accent'] },
  { key: 'signals', tokens: ['profit', 'loss', 'warning', 'info'] },
];

function TokenRow({
  token,
  value,
  onChange,
}: {
  token: TokenKey;
  value: string;
  onChange: (hex: string) => void;
}) {
  const { t } = useTranslation('settings');
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const id = `token-${token}`;
  const label = t(`appearance.tokens.${token}.label`);
  return (
    <div className="flex items-center gap-3 py-1.5">
      <input
        id={`${id}-picker`}
        type="color"
        value={value.toLowerCase()}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('appearance.pickColor', { token: label })}
        className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5 focus-ring"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-sm font-medium text-text">
          {label}
        </label>
        <p className="truncate text-xs text-text-muted">
          {t(`appearance.tokens.${token}.use`)} ·{' '}
          <code className="font-mono">--ls-{TOKEN_CSS_NAME[token]}</code>
        </p>
      </div>
      <input
        id={id}
        value={text}
        onChange={(e) => {
          const v = e.target.value.trim();
          setText(v);
          if (isHexColor(v)) onChange(v);
        }}
        onBlur={() => setText(value)}
        spellCheck={false}
        maxLength={7}
        aria-invalid={!isHexColor(text)}
        className="h-8 w-24 rounded-md border border-border bg-bg px-2 font-mono text-xs uppercase text-text focus-ring aria-[invalid=true]:border-loss"
      />
    </div>
  );
}

/** Per-token colour pickers, grouped by role. */
export function TokenEditor({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (token: TokenKey, hex: string) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-4">
      {TOKEN_GROUPS.map((g) => (
        <fieldset key={g.key}>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t(`appearance.groups.${g.key}`)}
          </legend>
          <div className="divide-y divide-border">
            {g.tokens.map((tok) => (
              <TokenRow
                key={tok}
                token={tok}
                value={theme.tokens[tok]}
                onChange={(hex) => onChange(tok, hex)}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
