/**
 * Regression guard for the site-page #329 crash (Sep 2026).
 *
 * A Server Component imported the runtime value TAB_KEYS from a 'use client' module. Next.js only
 * hands server code a client-reference proxy for such values, so `TAB_KEYS.includes(...)` threw during
 * the server render of every site page. These tests keep that from coming back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SITE_TAB_KEYS, isSiteTabKey } from '@/lib/ui/siteTabs';
import { TAB_KEYS } from '@/components/SiteIntelligenceTabs';

const ROOT = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const isClient = (src: string) => /^\s*['"]use client['"]/.test(src);

describe('site tab keys', () => {
  it('server-safe SITE_TAB_KEYS match the client TABS', () => {
    expect([...SITE_TAB_KEYS]).toEqual([...TAB_KEYS]);
  });
  it('isSiteTabKey validates', () => {
    expect(isSiteTabKey('analysis')).toBe(true);
    expect(isSiteTabKey('lease')).toBe(true);
    expect(isSiteTabKey('bogus')).toBe(false);
    expect(isSiteTabKey(undefined)).toBe(false);
  });
});

describe('server ↔ client boundary', () => {
  it('no server file imports a non-component runtime value from a "use client" module', () => {
    const files = ['app', 'components', 'lib'].flatMap((d) => walk(join(ROOT, d)));
    const clientMods = new Set(
      files
        .filter((f) => isClient(readFileSync(f, 'utf8')))
        .map((f) => relative(ROOT, f).replace(/\\/g, '/').replace(/\.(ts|tsx)$/, '')),
    );
    const offenders: string[] = [];
    const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@\/([^']+)'/g;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (isClient(src)) continue;
      for (const m of src.matchAll(re)) {
        if (m[1] || !clientMods.has(m[3])) continue;
        for (const raw of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
          if (raw.startsWith('type ')) continue;
          const name = raw.split(' as ')[0].trim();
          // PascalCase = a component (fine to render from a server component). Anything else is a value.
          if (!/^[A-Z][a-z]/.test(name)) offenders.push(`${relative(ROOT, f)} imports "${name}" from client module @/${m[3]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
