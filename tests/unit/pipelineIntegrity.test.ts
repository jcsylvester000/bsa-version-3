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
  it('claims a site with a conditional updateMany on claimedAt', () => {
    expect(orch).toMatch(/updateMany\(\{[\s\S]*?analyzedAt:\s*null[\s\S]*?claimedAt:\s*null[\s\S]*?data:\s*\{\s*claimedAt:/);
  });
  it('skips a site when the claim is lost (count === 0)', () => {
    expect(orch).toMatch(/claim\.count === 0\)\s*continue/);
  });
  it('lets a stale claim be retaken', () => {
    expect(orch).toContain('CLAIM_STALE_MS');
    expect(orch).toMatch(/claimedAt:\s*\{\s*lt:/);
  });
  it('clears the claim on refresh', () => {
    expect(orch).toMatch(/refresh[\s\S]*?claimedAt:\s*null/);
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
    expect(intake).toMatch(/outlet\.deleteMany\(\{ where: \{ intakeSubmissionId: cleanup\.intakeId/);
    expect(intake).toMatch(/franchisor\.delete\(\{ where: \{ id: cleanup\.createdFranchisorId/);
  });
});
