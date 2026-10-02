/**
 * The interface primitives.
 *
 * A small, opinionated set rather than a general-purpose component library: one button,
 * one input, one card, one table. Consistency in a dense internal tool comes from having
 * few choices, not from having many options (spec section 37).
 */
import { cn } from '../../lib/cn.js';
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

// ------------------------------------------------------------------- button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border-transparent',
  secondary: 'bg-surface text-ink border-line-strong hover:bg-canvas',
  ghost: 'bg-transparent text-ink-soft border-transparent hover:bg-canvas hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-95 border-transparent',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks further clicks; the label stays put so nothing jumps. */
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  );
});

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// -------------------------------------------------------------------- inputs

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a control with its label, hint and error.
 *
 * The error replaces the hint rather than appearing alongside it, so the layout does not
 * shift when validation fails.
 */
export function Field({ label, htmlFor, hint, error, required, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
        {required === true && (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error != null ? (
        <p className="text-[12px] text-danger" role="alert">
          {error}
        </p>
      ) : hint != null ? (
        <p className="text-[12px] text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL_CLASS =
  'w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint ' +
  'transition-colors hover:border-ink-faint focus:border-accent disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-faint';

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid === true || undefined}
      className={cn(CONTROL_CLASS, 'h-9', invalid === true && 'border-danger', className)}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(CONTROL_CLASS, 'resize-y py-2 leading-relaxed', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(CONTROL_CLASS, 'h-9 pr-8', className)} {...rest}>
        {children}
      </select>
    );
  },
);

export function Checkbox({
  label,
  description,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded border-line-strong text-accent accent-[var(--color-accent)]"
        {...rest}
      />
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {description != null && (
          <span className="block text-[12px] text-ink-faint">{description}</span>
        )}
      </span>
    </label>
  );
}

// --------------------------------------------------------------------- card

export function Card({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('card overflow-hidden', className)}>
      {(title != null || action != null) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {typeof title === 'string' ? (
              <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
            ) : (
              title
            )}
            {description != null && (
              <p className="mt-0.5 text-[12px] text-ink-faint">{description}</p>
            )}
          </div>
          {action != null && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

// -------------------------------------------------------------------- badge

type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-canvas text-ink-soft border-line-strong',
  accent: 'bg-accent-soft text-accent border-transparent',
  ok: 'bg-ok-soft text-ok border-transparent',
  warn: 'bg-warn-soft text-[oklch(45%_0.12_70)] border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  info: 'bg-info-soft text-info border-transparent',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ states

/**
 * The empty state. Always says what the thing is and what to do next, because "No data"
 * tells a user nothing (spec section 37).
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon != null && <div className="text-ink-faint">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description != null && <p className="max-w-sm text-[13px] text-ink-faint">{description}</p>}
      {action != null && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-12 text-ink-faint">
      <Spinner />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

/**
 * The error state. Shows what failed and offers a retry; the request id is included so a
 * user reporting the problem can quote one string that finds the log line.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  const requestId =
    typeof error === 'object' && error != null && 'requestId' in error
      ? (error as { requestId?: string | null }).requestId
      : null;

  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-danger">{message}</p>
      {requestId != null && <p className="text-[11px] text-ink-faint">Reference: {requestId}</p>}
      {onRetry != null && (
        <Button size="sm" onClick={onRetry} className="mt-1">
          Try again
        </Button>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- table

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)}>{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-line px-3 py-2 text-[11px] font-semibold tracking-wide text-ink-faint uppercase',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  colSpan,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'border-b border-line px-3 py-2.5 align-middle text-ink',
        align === 'right' && 'text-right tabular',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

// ----------------------------------------------------------------- progress

export function ProgressBar({
  value,
  tone = 'accent',
  showLabel = false,
  className,
}: {
  value: number;
  tone?: 'accent' | 'ok' | 'warn' | 'danger';
  showLabel?: boolean;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const fill =
    tone === 'ok'
      ? 'bg-ok'
      : tone === 'warn'
        ? 'bg-warn'
        : tone === 'danger'
          ? 'bg-danger'
          : 'bg-accent';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full transition-[width]', fill)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="tabular w-9 text-right text-[12px] text-ink-soft">{clamped}%</span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ metrics

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'ok' | 'warn' | 'danger';
}) {
  return (
    <div className="card px-4 py-3">
      <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">{label}</p>
      <p
        className={cn(
          'tabular mt-1 text-2xl font-semibold',
          tone === 'ok' && 'text-ok',
          tone === 'warn' && 'text-warn',
          tone === 'danger' && 'text-danger',
          tone == null && 'text-ink',
        )}
      >
        {value}
      </p>
      {hint != null && <p className="mt-0.5 text-[12px] text-ink-faint">{hint}</p>}
    </div>
  );
}
