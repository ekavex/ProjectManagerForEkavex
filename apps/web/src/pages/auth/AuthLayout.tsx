import type { ReactNode } from 'react';

/** The frame the three sign-in screens share. */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-lg bg-accent text-base font-bold text-white">
            E
          </div>
          <span className="text-lg font-semibold tracking-tight">Ekavist</span>
        </div>

        <div className="card p-6">
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          {subtitle != null && <p className="mt-1 mb-5 text-[13px] text-ink-faint">{subtitle}</p>}
          {subtitle == null && <div className="mb-5" />}
          {children}
        </div>
      </div>
    </div>
  );
}
