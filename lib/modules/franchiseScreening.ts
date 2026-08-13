/**
 * Franchise Screening — the pre-site franchise-decision layer.
 *
 * Answers the top-of-funnel question a prospective franchisee asks BEFORE any site
 * question: "given my budget and my available floor area, which brands should I even
 * consider?" Takes the standardized franchise-requirements matrix (fee / investment /
 * min-space / payback, all free text) and returns a ranked, comparable shortlist.
 *
 * Pure + deterministic so it unit-tests cleanly and the API layer just calls it. The
 * heterogeneous free-text fields are parsed to numeric ranges here (the "payback illusion"
 * and "capital-tier blind spot" fixes from the Franchise Market-Problems brief), while the
 * brand's Truth Layer classification travels through untouched — nothing is presented as
 * more certain than the source states.
 */
import { parseMinSqm, type FranchiseRequirements } from './franchiseTemplate';

export interface NumRange { min: number; max: number }
export interface PaybackRange extends NumRange { estimated: boolean }

/**
 * Parse a free-text peso amount / range into a numeric min–max in pesos. Handles
 * "₱15M–35M", "₱600K–6M", "₱50,000–₱285,000", "₱1.2M system enrollment". Multipliers
 * M/K/B are honoured; bare numbers under 1,000 with no unit are ignored (they are almost
 * always frontage metres or years, not pesos). Returns null when no amount is found.
 */
export function parseInvestment(s: string | null | undefined): NumRange | null {
  if (!s) return null;
  const t = String(s).replace(/,/g, '');
  const nums: number[] = [];
  for (const m of t.matchAll(/₱?\s*([\d.]+)\s*(m|k|b|thousand|million|billion)?/gi)) {
    let n = parseFloat(m[1]);
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] || '').trim().toLowerCase();
    if (unit === 'm' || unit === 'million') n *= 1e6;
    else if (unit === 'k' || unit === 'thousand') n *= 1e3;
    else if (unit === 'b' || unit === 'billion') n *= 1e9;
    else if (n < 1000) continue; // bare small number with no unit → not a peso amount
    nums.push(n);
  }
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/**
 * Parse a free-text payback string into a numeric YEAR range, normalizing months to
 * years so every brand's payback sits on one horizon (the "payback illusion" fix).
 * Handles "4–5 yrs (est.)", "~1.2 yrs", "Up to 10 yrs", "12–18 months". Flags whether the
 * source called it an estimate. Returns null when no duration is found.
 */
export function parsePayback(s: string | null | undefined): PaybackRange | null {
  if (!s) return null;
  const t = String(s).toLowerCase();
  const years: number[] = [];
  for (const m of t.matchAll(/([\d.]+)\s*(?:–|-|—|to)?\s*([\d.]*)\s*(?:yr|year|yrs)/gi)) {
    if (m[1]) years.push(parseFloat(m[1]));
    if (m[2]) years.push(parseFloat(m[2]));
  }
  for (const m of t.matchAll(/([\d.]+)\s*(?:–|-|—|to)?\s*([\d.]*)\s*(?:mo|month|mos)/gi)) {
    if (m[1]) years.push(parseFloat(m[1]) / 12);
    if (m[2]) years.push(parseFloat(m[2]) / 12);
  }
  const all = years.filter((n) => Number.isFinite(n) && n > 0);
  if (!all.length) return null;
  const estimated = /est|approx|~/.test(t);
  return { min: Math.min(...all), max: Math.max(...all), estimated };
}

/** Parse the confidence "95%" → 95 (number) for display / sorting. */
export function parseConfidence(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d+(?:\.\d+)?)\s*%?/);
  return m ? Number(m[1]) : null;
}

export interface ScreeningInput {
  /** Buyer's total budget in pesos (the money they can commit). */
  budgetPhp: number | null;
  /** Available floor area in sqm (the space they have or can lease). Optional. */
  floorAreaSqm: number | null;
  /** Optional vertical filter (e.g. only F&B). */
  vertical?: string | null;
}

export interface BrandInput {
  brand: string;
  requirements: FranchiseRequirements;
}

export interface ScreenedBrand {
  brand: string;
  category: string | null;
  vertical: string | null;
  franchisor: string | null;
  investment: NumRange | null;
  franchiseFee: NumRange | null;
  minSqm: number | null;
  payback: PaybackRange | null;
  truthLayer: string | null;
  confidence: number | null;
  /** 0–100 fit score for the buyer's budget + space. Higher = better fit. */
  fitScore: number;
  /** Plain-language reasons, e.g. "within budget", "needs more space than you have". */
  reasons: string[];
  /** True when the brand's minimum investment exceeds the budget (hard fail). */
  overBudget: boolean;
  /** True when the brand needs more floor area than the buyer stated. */
  overSpace: boolean;
  source: string | null;
  /** Provenance: "PFA" for PFA-directory imports, else null (original catalogue). */
  dataset: string | null;
  /** "supplier" for Allied members (not a franchise offer); null for franchises. */
  memberType: string | null;
}

/**
 * Score one brand against the buyer's budget + space. The score rewards affordability
 * headroom and a footprint that fits, and is penalized (not zeroed) when a figure is
 * missing so a data-thin brand ranks below a well-documented comparable rather than
 * silently disappearing. Faster/verified payback nudges the score up slightly.
 */
export function scoreBrand(b: BrandInput, input: ScreeningInput): ScreenedBrand {
  const r = b.requirements ?? {};

  // Allied / supplier members are NOT franchise offers — they have no investment,
  // space or payback to rank on. Score them 0 so they always sink below every real
  // franchise, and skip the budget/space math entirely. They stay in the list (tagged
  // "Supplier", findable via the Source filter) but never distort the shortlist.
  if ((r.memberType ?? '').toLowerCase() === 'supplier') {
    return {
      brand: b.brand,
      category: r.category ?? null,
      vertical: r.vertical ?? null,
      franchisor: r.franchisor ?? null,
      investment: null, franchiseFee: null, minSqm: null, payback: null,
      truthLayer: r.truthLayer ?? null,
      confidence: parseConfidence(r.confidence),
      fitScore: 0,
      reasons: ['Allied member / supplier — a vendor, not a franchise offer'],
      overBudget: false, overSpace: false,
      source: r.source ?? null,
      dataset: r.dataset ?? null,
      memberType: 'supplier',
    };
  }

  const investment = parseInvestment(r.totalInvestment);
  const franchiseFee = parseInvestment(r.franchiseFee);
  const minSqm = parseMinSqm(r.minSpace);
  const payback = parsePayback(r.roiPayback);
  const confidence = parseConfidence(r.confidence);

  const reasons: string[] = [];
  let score = 50; // neutral baseline

  // --- Budget fit ---
  let overBudget = false;
  if (input.budgetPhp != null && investment) {
    if (investment.min > input.budgetPhp) {
      overBudget = true;
      score -= 45;
      reasons.push(`Entry investment (₱${fmtPhp(investment.min)}) is above your budget`);
    } else if (investment.max <= input.budgetPhp) {
      score += 25; // fully affordable, top-end included
      reasons.push('Comfortably within budget');
    } else {
      score += 12; // affordable at the low end, stretches at the top
      reasons.push('Within budget at the entry format');
    }
  } else if (input.budgetPhp != null && !investment) {
    score -= 6;
    reasons.push('Investment figure not stated — verify before shortlisting');
  }

  // --- Space fit ---
  let overSpace = false;
  if (input.floorAreaSqm != null && minSqm != null) {
    if (minSqm > input.floorAreaSqm) {
      overSpace = true;
      score -= 30;
      reasons.push(`Needs ~${minSqm} sqm — more than your ${input.floorAreaSqm} sqm`);
    } else {
      score += 15;
      reasons.push(`Fits your space (needs ~${minSqm} sqm)`);
    }
  } else if (input.floorAreaSqm != null && minSqm == null) {
    score -= 4;
    reasons.push('Minimum space not stated');
  }

  // --- Payback nudge (verified + faster is better) ---
  if (payback) {
    if (payback.min <= 2) score += 6;
    else if (payback.min <= 3.5) score += 3;
    if (!payback.estimated) score += 3; // a stated (not estimated) payback is more trustworthy
  }

  // --- Confidence nudge ---
  if (confidence != null) score += Math.round((confidence - 70) / 10); // +/- around a 70% baseline

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    brand: b.brand,
    category: r.category ?? null,
    vertical: r.vertical ?? null,
    franchisor: r.franchisor ?? null,
    investment,
    franchiseFee,
    minSqm,
    payback,
    truthLayer: r.truthLayer ?? null,
    confidence,
    fitScore: score,
    reasons,
    overBudget,
    overSpace,
    source: r.source ?? null,
    dataset: r.dataset ?? null,
    memberType: r.memberType ?? null,
  };
}

/**
 * Screen + rank a set of brands for a buyer. Returns all brands sorted best-fit first.
 * A hard budget/space fail sinks a brand but does not remove it, so the buyer can see
 * what's just out of reach (and by how much) — the tool informs, it doesn't hide options.
 */
export function screenBrands(brands: BrandInput[], input: ScreeningInput): ScreenedBrand[] {
  const filtered = input.vertical
    ? brands.filter((b) => (b.requirements?.vertical ?? '') === input.vertical)
    : brands;
  return filtered
    .map((b) => scoreBrand(b, input))
    .sort((a, b) => b.fitScore - a.fitScore || (a.investment?.min ?? Infinity) - (b.investment?.min ?? Infinity));
}

/** Compact peso formatter for reason strings: 15000000 → "15.0M", 285000 → "285K". */
export function fmtPhp(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

/**
 * The three capital tiers from the Franchise Market-Problems brief, so the UI can band a
 * brand at a glance. Space (not fee) is what sorts a brand into its tier in the source.
 */
export function capitalTier(investmentMin: number | null): 'entry' | 'mid' | 'institutional' | null {
  if (investmentMin == null) return null;
  if (investmentMin <= 600_000) return 'entry';
  if (investmentMin <= 6_000_000) return 'mid';
  return 'institutional';
}
