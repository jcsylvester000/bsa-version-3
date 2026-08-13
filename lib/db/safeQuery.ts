/**
 * Run a Prisma read that must not crash a server-rendered page. If the database is
 * unreachable (e.g. mock mode with no DB configured, or a down local Postgres), the
 * fallback is returned and the page renders an empty/degraded state instead of a 500.
 */
import 'server-only';

export async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<{ data: T; dbDown: boolean }> {
  try {
    const data = await fn();
    return { data, dbDown: false };
  } catch (err) {
    console.warn('[safeQuery] database read failed, using fallback', err instanceof Error ? err.message : err);
    return { data: fallback, dbDown: true };
  }
}
