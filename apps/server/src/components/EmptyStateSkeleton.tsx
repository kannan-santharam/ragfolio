'use client';

/**
 * Placeholder for the landing copy while `/api/documents` is in flight.
 *
 * The copy below it is decided entirely by that response — whether anything is
 * indexed, whether the origin is trusted, which region's profile applies — so
 * there is nothing honest to render until it lands. Rendering nothing was the
 * previous answer and it reads as a broken page: the portfolio iframe opens
 * blank, then a heading appears from nowhere a few hundred milliseconds later.
 *
 * Deliberately generic. `EmptyState` has two layouts that occupy the same space —
 * four starter prompts when documents exist, four pipeline cards when they do
 * not — and which one wins is the very thing being waited on. So this mirrors the
 * scaffold they share (badge, heading, blurb, a four-up grid) rather than
 * guessing a branch and jolting when the guess is wrong.
 */
export function EmptyStateSkeleton() {
  return (
    <div
      aria-hidden
      className="mx-auto flex w-full max-w-3xl animate-pulse flex-col items-center px-4 py-10"
    >
      <div className="mb-5 h-14 w-14 rounded-2xl bg-[var(--bg-card)]" />

      <div className="h-7 w-64 rounded-lg bg-[var(--bg-card)] sm:h-8 sm:w-80" />

      <div className="mt-4 flex w-full max-w-lg flex-col items-center gap-2">
        <div className="h-3 w-full rounded bg-[var(--bg-card)]" />
        <div className="h-3 w-11/12 rounded bg-[var(--bg-card)]" />
        <div className="h-3 w-3/4 rounded bg-[var(--bg-card)]" />
      </div>

      <div className="mt-7 grid w-full gap-2 sm:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-[4.25rem] rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)]"
          />
        ))}
      </div>
    </div>
  );
}
