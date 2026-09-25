/**
 * F-05 / F-06 integrity guards.
 *  - F-05: the orchestrator must CLAIM each site (conditional updateMany on claimedAt) before
 *    working it, and skip a site whose claim another invocation already holds.
 *  - F-06: the intake route must run its gates before any write, and roll back on failure.
 * These are source-level guards — the behaviour is DB-concurrency shaped and expensive to
 * reproduce, but the specific lines that provide the guarantee are easy to pin.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
const orch = read('lib', 'modules', 'orchestrator.ts');
const intake = read('app', 'api', 'intake', 'route.ts');

describe('F-05 per-site claim', () => {
  it('claims a site with ONE raw conditional UPDATE on claimed_at', () => {
    expect(orch).toMatch(/UPDATE candidate_site SET claimed_at = now\(\)[\s\S]*?analyzed_at IS NULL[\s\S]*?claimed_at IS NULL OR claimed_at </);
  });
  it('skips a site when the claim is lost (0 rows)', () => {
    expect(orch).toMatch(/claimed === 0\)\s*continue/);
  });
  it('lets a stale claim be retaken', () => {
    expect(orch).toContain('CLAIM_STALE_MS');
  });
  it('clears the claim on refresh', () => {
    expect(orch).toMatch(/refresh[\s\S]*?claimed_at = NULL/);
  });
  it('a claim error never fails the run (falls back to processing the site)', () => {
    expect(orch).toMatch(/claim skipped for site/);
  });
});

describe('Neon HTTP safety (Sep 25 hotfix)', () => {
  // prisma.updateMany / deleteMany / createMany can open an implicit transaction, which the Neon
  // HTTP adapter rejects. Request-path code must use single statements instead.
  it('the orchestrator and intake route use no updateMany/deleteMany/createMany calls', () => {
    const strip = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const src of [orch, intake]) {
      expect(strip(src)).not.toMatch(/\.(updateMany|deleteMany|createMany)\(/);
    }
  });
});

describe('F-06 intake writes are gated and rolled back', () => {
  it('does not create a franchisor before the completeness gate', () => {
    const gateAt = intake.indexOf('completeness.pct < 80');
    const firstCreate = intake.indexOf('prisma.franchisor.create');
    expect(gateAt).toBeGreaterThan(0);
    expect(firstCreate).toBeGreaterThan(gateAt); // the only create() sits after the gate
  });
  it('tracks written ids and compensates on failure', () => {
    expect(intake).toContain('cleanup.createdFranchisorId');
    expect(intake).toContain('cleanup.intakeId');
    expect(intake).toContain('cleanup.runId');
    // Rollback deletes run (cascades sites), outlets, intake, and the brand only if we created it.
    expect(intake).toMatch(/pipelineRun\.delete\(\{ where: \{ id: cleanup\.runId/);
    expect(intake).toMatch(/DELETE FROM outlet WHERE intake_submission_id = \$\{cleanup\.intakeId\}/);
    expect(intake).toMatch(/franchisor\.delete\(\{ where: \{ id: cleanup\.createdFranchisorId/);
  });
});
