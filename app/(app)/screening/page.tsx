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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink-text">Franchise Screening</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Before you pick a site, pick the right brands. Enter your budget and the floor area you have,
          and BSA ranks the franchise catalogue by how well each fits — investment, footprint and payback
          compared side by side, every figure tagged with its Truth Layer. Shortlist here, then run a full
          site analysis on the winners.
        </p>
      </div>
      <FranchiseScreeningView />
    </div>
  );
}
