/**
 * Modals, confirmation dialogs and toasts.
 *
 * Every destructive action goes through `useConfirm` rather than a bare button, so there
 * is one consistent place where the consequence is spelled out (spec section 37).
 */
import { cn } from '../../lib/cn.js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from './primitives.js';

// -------------------------------------------------------------------- modal

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    // Stop the page behind the dialog from scrolling while it is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog so a keyboard user is not left behind on the page.
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 10);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  const width =
    size === 'sm'
      ? 'max-w-md'
      : size === 'lg'
        ? 'max-w-3xl'
        : size === 'xl'
          ? 'max-w-5xl'
          : 'max-w-xl';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[oklch(20%_0.02_255_/_0.45)] p-0 sm:items-center sm:p-6">
      {/* A click outside closes, matching what people expect from a dialog. */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative z-10 w-full rounded-t-xl bg-surface shadow-xl sm:rounded-xl',
          width,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description != null && (
              <p className="mt-0.5 text-[13px] text-ink-faint">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1 rounded p-1 text-ink-faint hover:bg-canvas hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="scroll-thin max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>

        {footer != null && (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------- confirmation

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
}

const ConfirmContext = createContext<((request: ConfirmRequest) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmRequest) => {
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setRequest(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={request != null}
        onClose={() => settle(false)}
        title={request?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => settle(false)}>Cancel</Button>
            <Button
              variant={request?.tone === 'primary' ? 'primary' : 'danger'}
              onClick={() => settle(true)}
            >
              {request?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">{request?.message}</p>
      </Modal>
    </ConfirmContext.Provider>
  );
}

/** Returns a function that resolves to true only if the person confirmed. */
export function useConfirm(): (request: ConfirmRequest) => Promise<boolean> {
  const context = useContext(ConfirmContext);
  if (context == null) throw new Error('useConfirm must be used inside a ConfirmProvider.');
  return context;
}

// -------------------------------------------------------------------- toast

interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, tone, message }]);
    // Errors stay longer, because they usually need reading rather than glancing at.
    window.setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      tone === 'error' ? 7000 : 4000,
    );
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto rounded-md border px-3.5 py-2.5 text-[13px] shadow-lg',
              toast.tone === 'success' && 'border-transparent bg-ok text-white',
              toast.tone === 'error' && 'border-transparent bg-danger text-white',
              toast.tone === 'info' && 'border-line-strong bg-surface text-ink',
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context == null) throw new Error('useToast must be used inside a ToastProvider.');
  return context;
}
