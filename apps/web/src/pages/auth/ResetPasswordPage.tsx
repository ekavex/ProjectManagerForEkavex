import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Field, Input } from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { AuthLayout } from './AuthLayout.js';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (token === '') {
    return (
      <AuthLayout title="That link is incomplete">
        <p className="text-[13px] text-ink-soft">
          The reset link is missing its token. Request a new one and use the most recent email.
        </p>
        <Link to="/forgot-password" className="mt-4 block text-[13px] text-accent hover:underline">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }
    setError(null);
    setSubmitting(true);

    void api
      .post('/auth/reset-password', { token, password })
      .then(() => navigate('/login', { replace: true }))
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'That did not work. Try again.');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error != null && (
          <div
            className="rounded-md border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
            role="alert"
          >
            {error}
          </div>
        )}
        <Field
          label="New password"
          htmlFor="password"
          required
          hint="At least 10 characters. A memorable phrase beats a short, complicated word."
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label="Confirm the password" htmlFor="confirmation" required>
          <Input
            id="confirmation"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" loading={submitting} className="w-full">
          Set the password and sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
