import { getSession } from '@/lib/auth/session';
import { FranchiseScreeningView } from '@/components/FranchiseScreeningView';

export const dynamic = 'force-dynamic';

/**
 * Franchise Screening page — the pre-site franchise-decision front end. A buyer enters
 * budget + available floor area and gets a ranked, comparable shortlist of brands from the
 * standardized requirements matrix, before choosing a site. Complements the site-analysis
 * pipeline: screen here, then run a full intake on the brands that survive.
 */
export default async function ScreeningPage() {
  const session = await getSession();
  if (!session) return null;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-1.5">
        <h1 className="text-h1">Franchise Screening</h1>
        <p className="max-w-3xl text-body text-ink-muted">
          Browse brands by what they require. Set your budget and floor area, compare investment, space and
          payback side by side — every figure tagged with its Truth Layer — then pick one to start an intake.
        </p>
      </div>
      <FranchiseScreeningView />
    </div>
  );
}
