'use client';

import { Settings2 } from 'lucide-react';

/**
 * Owner-facing setup guidance, shown in place of the chat when the server has
 * no provider key or database configured. A visitor never sees this on a
 * finished deployment; the person who sees it is the one who can fix it.
 */
export function SetupCard({ missing }: { missing: string[] }) {
  const steps = [
    {
      title: 'Run the setup wizard',
      body: (
        <>
          In the project folder run <code className={CODE}>npx ragfolio init</code>. It asks for your provider, keys and
          Supabase project, applies the database schema and writes <code className={CODE}>.env.local</code>.
        </>
      ),
    },
    {
      title: 'Add the variables where this app runs',
      body: (
        <>
          Locally: keep them in <code className={CODE}>apps/server/.env.local</code>. On Vercel: Project → Settings →
          Environment Variables, paste the contents of <code className={CODE}>.env.local</code>.
        </>
      ),
    },
    {
      title: 'Restart or redeploy',
      body: <>Restart the dev server, or trigger a redeploy on Vercel. This screen is replaced by the chat once the server can see the variables.</>,
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-4 py-10">
      <div className="mb-5 flex items-center gap-3">
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl">
          <span className="tech-gradient-bg absolute inset-0" />
          <Settings2 className="relative h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h2 className="text-brand-gradient text-xl font-extrabold sm:text-2xl">This deployment is not configured yet</h2>
          <p className="text-xs text-[var(--text-muted)]">Three steps, about five minutes</p>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3.5 py-3">
        <p className="text-[0.7rem] font-bold tracking-wide text-[var(--text-title)] uppercase">Missing</p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {missing.map((name) => (
            <li key={name} className="rounded-lg bg-[var(--bg-card)] px-2 py-1 font-mono text-[0.7rem] text-[var(--text-title)]">
              {name}
            </li>
          ))}
        </ul>
      </div>

      <ol className="mt-5 space-y-2.5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[0.65rem] font-bold text-white">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[var(--text-title)]">{step.title}</p>
              <p className="mt-0.5 text-[0.72rem] leading-relaxed text-[var(--text-muted)]">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-[0.68rem] leading-relaxed text-[var(--text-muted)]">
        Every variable is documented in <code className={CODE}>apps/server/.env.example</code>. Check a deployment with{' '}
        <code className={CODE}>npx ragfolio doctor --url https://your-app.vercel.app</code>.
      </p>
    </div>
  );
}

const CODE = 'rounded bg-[var(--bg-inner)] px-1 py-0.5 font-mono text-[0.68rem] text-[var(--text-title)]';
