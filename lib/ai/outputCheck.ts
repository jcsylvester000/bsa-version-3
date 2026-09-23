/**
 * Post-generation guardrail check for AI-written text. Pure, no I/O — unit-tested.
 *
 * Retrieve-then-generate promises the model never invents a number. Prompts ask for that;
 * this checks it. Every number in the model's output must be traceable to the text the
 * model was given (the site schema + retrieved interpretation reference). It also scans for
 * price-verdict wording (Grid guardrail: no price verdicts).
 *
 * The result is a WARNING, not a block: it is stored with the report, shown on the Analysis
 * tab and printed on the PDF so the broker checks those sentences before sharing. (A hard
 * block would throw away a paid generation over a harmless unit conversion.)
 */
import { PRICE_VERDICT_PATTERNS } from '@/lib/truth/guardrailCopy';

export interface OutputCheck {
  /** Numbers in the output that don't match any number in the sources (as written in the output). */
  ungroundedNumbers: string[];
  /** Price-verdict phrases found in the output. */
  priceVerdictPhrases: string[];
  ok: boolean;
}

// ₱ / PHP amounts, plain numbers with thousands separators or decimals, optional % sign.
const NUMBER_RE = /(?:₱|PHP\s?)?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|(?:₱|PHP\s?)?\d+(?:\.\d+)?%?/gi;

function toValue(token: string): number | null {
  const n = Number(token.replace(/₱|PHP|\s|,|%/gi, ''));
  return Number.isFinite(n) ? n : null;
}

/** Every numeric value appearing anywhere in the source texts. */
export function numbersIn(texts: string[]): number[] {
  const out: number[] = [];
  for (const t of texts) for (const m of t.match(NUMBER_RE) ?? []) {
    const v = toValue(m);
    if (v != null) out.push(v);
  }
  return out;
}

/** A number is grounded if it equals a source number, or is that number rounded (the model
 *  may say "57%" for 57.3%, or "₱12,500" for 12,480). */
function isGrounded(v: number, sources: number[]): boolean {
  return sources.some((s) => {
    if (s === v) return true;
    if (Math.round(s) === v) return true;                    // 57.3 → 57
    if (Math.round(s * 10) / 10 === v) return true;          // 57.34 → 57.3
    if (Math.abs(s) >= 1000 && Math.abs(s - v) / Math.abs(s) <= 0.01) return true; // ₱12,480 → ₱12,500
    return false;
  });
}

/** Small counts ("two sites", "top 3", "4 modules") and calendar years are not claims. */
function exempt(v: number): boolean {
  return (Number.isInteger(v) && v >= 0 && v <= 10) || (Number.isInteger(v) && v >= 1990 && v <= 2100);
}

export function checkAnalysisOutput(output: string, sources: string[]): OutputCheck {
  const allowed = numbersIn(sources);
  const ungrounded: string[] = [];
  for (const m of output.match(NUMBER_RE) ?? []) {
    const v = toValue(m);
    if (v == null || exempt(v)) continue;
    if (!isGrounded(v, allowed) && !ungrounded.includes(m.trim())) ungrounded.push(m.trim());
  }
  const phrases: string[] = [];
  for (const re of PRICE_VERDICT_PATTERNS) {
    const hit = output.match(re);
    if (hit && !phrases.includes(hit[0])) phrases.push(hit[0]);
  }
  return { ungroundedNumbers: ungrounded, priceVerdictPhrases: phrases, ok: ungrounded.length === 0 && phrases.length === 0 };
}
