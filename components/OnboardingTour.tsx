'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * OnboardingTour — the first-run guided walkthrough. Shows a sequence of short
 * "shout-out" call-outs, each anchored (when possible) to a real feature in the left
 * rail via a highlight ring, with Skip / Back / Next controls. Plays exactly once for
 * a brand-new user (driven by the DB `has_onboarded` flag passed as `show`), then
 * POSTs to /api/auth/onboarding to never auto-play again.
 *
 * Steps target elements by a `data-tour` attribute so the spotlight can ring the real
 * nav item; a step with no anchor renders a centered card (welcome / finish).
 *
 * Each step carries an expanded, broker-friendly `body` plus a `highlight` — the single
 * key takeaway, rendered in a bright amber-bordered callout box so a brand-new user can
 * see, at a glance, what they can actually do on that screen.
 */
interface Step {
  anchor?: string; // data-tour value to spotlight
  title: string;
  body: string;
  highlight: string; // the boxed, brightly-emphasised key takeaway
}

const STEPS: Step[] = [
  {
    title: 'Welcome to BSA 👋',
    body: "This is your Business Site Analysis workspace — the tool that helps you decide, with real data, whether a location is worth opening and whether it will quietly eat into the branches you already run. Over the next minute I'll walk you through the four screens you'll live in day to day. Nothing here replaces your judgment as a broker; BSA just puts the numbers in front of you so the conversation with a franchisee is grounded, not guessed.",
    highlight: 'BSA sharpens the site decision with data — you still close the deal.',
  },
  {
    anchor: 'nav-intake',
    title: 'Start with a New Intake',
    body: "Everything begins here. Tell BSA about the brand and the candidate sites you're weighing up. Pick a franchise from the built-in catalogue and its known requirements — footprint, target customer, format — auto-fill for you, or enter your own concept and benchmark it against a comparable brand. Add your existing outlets and the sites you're considering, then submit to run the full analysis.",
    highlight: 'Pick a brand → add your outlets and candidate sites → run the analysis.',
  },
  {
    anchor: 'nav-runs',
    title: 'Your Site Dashboard',
    body: 'Every analysis you run is saved here with a name and timestamp, so you can come back to it anytime. Open a run to see the ranked shortlist of sites, each with its own score and verdict. Need to adjust an assumption or add a site? Edit the inputs and re-run — BSA keeps the full version history, so you never lose an earlier take and can compare how the picture changed.',
    highlight: 'Open any saved run to see the ranked shortlist — edit and re-run anytime.',
  },
  {
    anchor: 'nav-modules',
    title: 'The Intelligence modules',
    body: 'This is where BSA reads each site from four angles. Territory Guard checks whether a new branch adds sales or cannibalises the ones you already have. Lease Benchmark shows how a site\'s asking rent compares to the corridor so a franchisee never signs a ten-year lease blind. Daypart Demand maps when the foot traffic actually shows up, and White-Space Map finds the gaps worth chasing. Look for the ⓘ icon on any result — it explains, in plain terms, how to read the number and how much to trust it.',
    highlight: 'Four lenses on every site — and the ⓘ icon tells you how to read each number.',
  },
  {
    anchor: 'nav-reports',
    title: 'Export a Site Report',
    body: "Once you've settled on a site, generate a clean, branded report your team — or a franchisee — can actually act on. It pulls together the shortlist, the scores, and the reasoning behind them into one shareable document, with every figure still carrying its honesty label so nobody mistakes an estimate for a measured fact. That's the whole loop: intake, analyse, report.",
    highlight: 'Turn the analysis into a shareable, branded report — one clean document.',
  },
  {
    title: "You're all set 🎉",
    body: 'That\'s the tour. The fastest way to see BSA work is to head to New Intake and run your first analysis on a brand and a couple of sites you already know — the results will feel a lot more real when you recognise the locations. If you ever want a refresher, you can re-open this walkthrough from the help icons scattered across the app.',
    highlight: 'Head to New Intake to run your first analysis — re-open this tour anytime from the ⓘ icons.',
  },
];

export function OnboardingTour({ show }: { show: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // The tour can be replayed on demand from anywhere by navigating to `?tour=1`
  // (e.g. the "Replay tour" button in Settings). That works for demo accounts too,
  // since it doesn't depend on the DB `has_onboarded` flag.
  const replay = params.get('tour') === '1';

  const [open, setOpen] = useState(show || replay);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = STEPS[i];

  // If the user lands with `?tour=1` (replay), open the tour from the first step.
  useEffect(() => {
    if (replay) {
      setI(0);
      setOpen(true);
    }
  }, [replay]);

  // Position the spotlight + card against the current step's anchor element.
  useEffect(() => {
    if (!open) return;
    if (!step.anchor) { setRect(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: 'nearest' });
    setRect(el.getBoundingClientRect());
  }, [open, i, step.anchor]);

  // Keep the spotlight aligned on resize/scroll.
  useEffect(() => {
    if (!open || !step.anchor) return;
    const update = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, step.anchor]);

  function finish() {
    setOpen(false);

    // If this was a manual replay (`?tour=1`), just strip the param so a refresh doesn't
    // reopen it — no DB write needed, and demo accounts can replay freely.
    if (replay) {
      const rest = new URLSearchParams(params.toString());
      rest.delete('tour');
      const qs = rest.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
      return;
    }

    // First-run: persist so it never auto-plays again. `keepalive` lets the request
    // outlive an immediate navigation (the finish CTA invites the user to click straight
    // into New Intake) — without it, that navigation can abort the in-flight POST and the
    // tour replays on the next load.
    fetch('/api/auth/onboarding', { method: 'POST', keepalive: true }).catch(() => {});
  }

  if (!open) return null;

  const isLast = i === STEPS.length - 1;

  // Card placement: beside the anchor if we have one, else centered. The card is wider
  // now (~560px), so when it's anchored we clamp its left edge to keep it fully on-screen
  // even if the anchor sits close to the right side of the viewport.
  const CARD_W = 560;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cardStyle: React.CSSProperties = rect
    ? {
        position: 'fixed',
        top: Math.min(Math.max(rect.top - 8, 12), vh - 320),
        left: Math.min(rect.right + 16, vw - CARD_W - 16),
        zIndex: 80,
      }
    : {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 80,
      };

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Getting started tour">
      {/* Dimmer. Clicking it advances nothing — user must use the controls (avoids accidental skips). */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Spotlight ring around the anchored feature. */}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-accent ring-offset-2 ring-offset-transparent transition-all"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.70)',
          }}
        />
      )}

      {/* Call-out card */}
      <div
        style={{ ...cardStyle, width: CARD_W }}
        className="max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-ink-border bg-ink-panel-2 shadow-2xl ring-1 ring-accent/20"
      >
        {/* Accent header band — gives the tour a clear, branded frame. */}
        <div className="flex items-center justify-between border-b border-ink-border bg-accent/10 px-7 py-3">
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-accent">
            Getting started · Step {i + 1} of {STEPS.length}
          </span>
          <button
            type="button"
            onClick={finish}
            className="text-xs font-medium text-ink-muted transition hover:text-ink-text"
          >
            Skip tour
          </button>
        </div>

        <div className="px-7 pb-7 pt-6">
          {/* Bright, bold title */}
          <h3 className="text-2xl font-extrabold leading-tight text-ink-text">{step.title}</h3>

          {/* Expanded body — brightened from muted to the full text colour for readability. */}
          <p className="mt-3 text-[15px] leading-relaxed text-ink-text/90">{step.body}</p>

          {/* Boxed, brightly-emphasised key takeaway. */}
          <div className="mt-5 rounded-xl border-l-4 border-accent bg-accent/10 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent/80">
              What you can do
            </div>
            <p className="mt-1 text-[15px] font-bold text-accent">{step.highlight}</p>
          </div>

          {/* progress dots */}
          <div className="mt-6 flex items-center gap-1.5">
            {STEPS.map((_, idx) => (
              <span
                key={idx}
                className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-6 bg-accent' : 'w-1.5 bg-ink-border'}`}
              />
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setI((n) => Math.max(0, n - 1))}
              disabled={i === 0}
              className="btn-ghost text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>
            {isLast ? (
              <button type="button" onClick={finish} className="btn-accent text-sm">
                Get started
              </button>
            ) : (
              <button type="button" onClick={() => setI((n) => Math.min(STEPS.length - 1, n + 1))} className="btn-accent text-sm">
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
