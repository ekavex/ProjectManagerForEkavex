import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, Input } from '../../components/ui/primitives.js';
import { useAuth } from '../../features/auth/AuthProvider.js';
import { ApiError } from '../../lib/api.js';
import { AuthLayout } from './AuthLayout.js';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    void signIn(email, password)
      .then(() => {
        const from = (location.state as { from?: string } | null)?.from;
        navigate(from ?? '/', { replace: true });
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError('INTERNAL_ERROR', 'Could not reach the server.', 0),
        );
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <AuthLayout
      title="Sign in to Ekavist"
      subtitle="One place for every project, task and decision."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error != null && (
          <div
            className="rounded-md border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
            role="alert"
          >
            {error.message}
          </div>
        )}

        <Field label="Email" htmlFor="email" required error={error?.fieldError('email')}>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
          />
        </Field>

        <Field label="Password" htmlFor="password" required error={error?.fieldError('password')}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" loading={submitting} className="mt-1 w-full">
          Sign in
        </Button>

        <Link to="/forgot-password" className="self-center text-[13px] text-accent hover:underline">
          Forgot your password?
        </Link>
      </form>

      <p className="mt-6 border-t border-line pt-4 text-center text-[12px] text-ink-faint">
        Signing in is not the same as starting work. Once you are in, press{' '}
        <span className="font-medium text-ink-soft">Start work</span> to begin your day.
      </p>
    </AuthLayout>
  );
}
