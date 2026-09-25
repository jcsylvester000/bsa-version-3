/**
 * Signed-in loading state (design v2 · empty/loading states). Shown by Next while a server page
 * streams — shaped like a page header + cards so the layout doesn't jump when content arrives.
 * `.skeleton` respects prefers-reduced-motion (globals.css).
 */
export default function AppLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton h-9 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="skeleton h-28" />
        <div className="skeleton h-28" />
        <div className="skeleton h-28" />
      </div>
      <div className="skeleton h-72" />
    </div>
  );
}
