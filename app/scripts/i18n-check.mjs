#!/usr/bin/env node
/**
 * i18n completeness check: every key in every namespace must exist in every locale.
 * - Compares src/locales/<lang>/<namespace>.json across all languages.
 * - Plural suffixes (_zero/_one/_two/_few/_many/_other) are normalised, because languages
 *   legitimately have different plural forms (Spanish has _many, English doesn't).
 * - Also checks that interpolation variables ({{name}}) match across languages,
 *   that no value is empty, and that arrays have the same length.
 * Exits with code 1 on any problem.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/locales');
const PLURAL = /_(zero|one|two|few|many|other)$/;

const langs = readdirSync(root).filter((d) => statSync(path.join(root, d)).isDirectory());
const problems = [];

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out.set(key, { array: v.length, vars: varsOf(v.join(' ')) });
    else if (v && typeof v === 'object') flatten(v, key, out);
    else {
      if (typeof v !== 'string' || v.trim() === '') problems.push(`empty value: ${key}`);
      const base = key.replace(PLURAL, '');
      const prev = out.get(base);
      const vars = varsOf(String(v)).filter((x) => x !== 'count');
      out.set(base, { vars: prev ? [...new Set([...prev.vars, ...vars])].sort() : vars });
    }
  }
  return out;
}

function varsOf(s) {
  return [...s.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();
}

const namespaces = new Set();
for (const lang of langs) {
  for (const f of readdirSync(path.join(root, lang)))
    if (f.endsWith('.json')) namespaces.add(f.replace(/\.json$/, ''));
}

let keyCount = 0;
for (const ns of [...namespaces].sort()) {
  const maps = {};
  for (const lang of langs) {
    const file = path.join(root, lang, `${ns}.json`);
    try {
      maps[lang] = flatten(JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      problems.push(`[${lang}] ${ns}.json missing or invalid: ${e.message}`);
      maps[lang] = new Map();
    }
  }
  const all = new Set(Object.values(maps).flatMap((m) => [...m.keys()]));
  keyCount += all.size;
  for (const key of [...all].sort()) {
    const ref = langs.map((l) => maps[l].get(key)).find(Boolean);
    for (const lang of langs) {
      const entry = maps[lang].get(key);
      if (!entry) {
        problems.push(`[${lang}] missing ${ns}:${key}`);
        continue;
      }
      if (ref.array !== undefined && entry.array !== ref.array) {
        problems.push(
          `[${lang}] array length differs for ${ns}:${key} (${entry.array} vs ${ref.array})`,
        );
      }
      if (entry.vars.join(',') !== ref.vars.join(',')) {
        problems.push(
          `[${lang}] interpolation vars differ for ${ns}:${key}: {${entry.vars}} vs {${ref.vars}}`,
        );
      }
    }
  }
}

if (problems.length) {
  console.error(`i18n check failed (${problems.length} problem${problems.length > 1 ? 's' : ''}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `i18n check passed: ${langs.length} locales (${langs.join(', ')}), ${namespaces.size} namespaces, ${keyCount} keys.`,
);
