/**
 * True when `s` looks like a canonical UUID. Used to guard Prisma `findUnique({ where:
 * { id } })` calls against non-UUID inputs (e.g. the demo run id `mock-run-…`), which
 * otherwise make Postgres throw "Error creating UUID" and crash the page. Callers should
 * treat a non-UUID id as "not found" rather than pass it to the DB.
 */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(s: string | null | undefined): s is string {
  return typeof s === 'string' && UUID_RE.test(s);
}
