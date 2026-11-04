/**
 * Which accounts are test / demo accounts (Brief alignment T-7). Their runs, intakes and typed outlets
 * are left out of the production counts quoted to investors. Pure — unit-tested.
 */
export function isTestAccountEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  return e.endsWith('@local') || e.endsWith('.test') || e.endsWith('.local') || e.endsWith('@example.com')
    || /(^|[.+_-])(demo|test|qa)([.+_@-]|$)/.test(e.split('@')[0] + '@');
}
