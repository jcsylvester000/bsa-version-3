/**
 * Resolve which run an Intelligence page should show when the URL has no ?runId.
 *
 * The standalone Intelligence pages (Territory Guard, Lease Benchmark, All Modules,
 * Scorecard) used to dead-end with "Open a run from the Runs list" when reached
 * directly from the left nav. That reads as broken to a first-time user. This helper
 * gives them a sensible default so the nav always lands on something:
 *   - a built-in demo account → the demo run (its mock branch renders sample data);
 *   - a real signed-in user → their most-recent accessible run (admins/analysts see the
 *     latest run overall; everyone else sees only runs they created);
 *   - genuinely no runs → null, and the page shows its (now accurate) empty state.
 *
 * Server-only: touches Prisma. Never widens access — the scoping mirrors the Runs list.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { isMockUser } from '@/lib/auth/mockUsers';
import { isUuid } from '@/lib/util/uuid';
import { DEMO_RUN_ID } from '@/lib/mock/mockCompute';
import type { SessionUser } from '@/lib/auth/auth';

export async function resolveDefaultRunId(session: SessionUser | null): Promise<string | null> {
  if (!session) return null;

  // Built-in demo accounts always default to the demo run (their pages render sample
  // data from the mock branch). Their id is a non-UUID sentinel, so we never query the
  // UUID-typed createdByUserId column with it.
  if (isMockUser(session)) return DEMO_RUN_ID;

  // Real users: same scoping as the Runs list — staff see everything, everyone else
  // sees only what they created.
  const isStaff = session.role === 'admin' || session.role === 'analyst';
  // A non-staff user whose id isn't a UUID (shouldn't happen for a real account) has no
  // runs we can safely query — bail rather than parse a bad id into a UUID column.
  if (!isStaff && !isUuid(session.id)) return null;
  const scoped = isStaff ? {} : { createdByUserId: session.id };

  try {
    const run = await prisma.pipelineRun.findFirst({
      where: scoped,
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return run?.id ?? null;
  } catch {
    return null;
  }
}
