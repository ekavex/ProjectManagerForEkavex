import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Field, Input } from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';
import { AuthLayout } from './AuthLayout.js';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setSubmitting(true);
    // The server answers the same way whether or not the address exists, so the screen
    // does too: confirming which addresses have accounts would be a disclosure.
    void api
      .post('/auth/forgot-password', { email })
      .catch(() => undefined)
      .finally(() => {
        setSubmitting(false);
        setSent(true);
      });
  };

  return (
    <AuthLayout title="Reset your password">
      {sent ? (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-ink-soft">
            If <span className="font-medium text-ink">{email}</span> belongs to an Ekavist account,
            a reset link is on its way. The link is valid for one hour.
          </p>
          <Link to="/login" className="text-[13px] text-accent hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="text-[13px] text-ink-soft">
            Enter your email address and we will send you a link to choose a new password.
          </p>
          <Field label="Email" htmlFor="email" required>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" loading={submitting} className="w-full">
            Send the reset link
          </Button>
          <Link to="/login" className="self-center text-[13px] text-accent hover:underline">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
