/**
 * Two-factor sign-in: enrol with an authenticator app, keep the recovery codes, turn it
 * off again. The QR code is drawn in the browser, so the secret never leaves the page.
 */
import type { TwoFactorEnrolment } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useToast } from '../../components/ui/overlays.js';
import { Badge, Button, Card, Field, Input, LoadingState } from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { formatRelative } from '../../lib/format.js';
import { keys, useTwoFactorStatus } from '../../lib/queries.js';

export function TwoFactorCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: status, isLoading } = useTwoFactorStatus();
  const [enrolment, setEnrolment] = useState<TwoFactorEnrolment | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (enrolment == null) {
      setQr(null);
      return;
    }
    void QRCode.toDataURL(enrolment.otpauthUrl, { margin: 1, width: 176 }).then(setQr);
  }, [enrolment]);

  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: keys.twoFactor });
  const fail = (fallback: string) => (cause: unknown) =>
    toast.error(cause instanceof ApiError ? cause.message : fallback);

  const begin = useMutation({
    mutationFn: () => api.post<TwoFactorEnrolment>('/auth/two-factor/enrol'),
    onSuccess: (result) => {
      setCode('');
      setEnrolment(result);
    },
    onError: fail('Could not start enrolment.'),
  });

  const confirm = useMutation({
    mutationFn: () =>
      api.post<{ recoveryCodes: string[] }>('/auth/two-factor/confirm', { code: code.trim() }),
    onSuccess: (result) => {
      setEnrolment(null);
      setCode('');
      setRecoveryCodes(result.recoveryCodes);
      refresh();
      toast.success('Two-factor sign-in is on.');
    },
    onError: fail('That code did not work.'),
  });

  const disable = useMutation({
    mutationFn: () => api.post('/auth/two-factor/disable', { password, code: code.trim() }),
    onSuccess: () => {
      setPassword('');
      setCode('');
      refresh();
      toast.success('Two-factor sign-in is off.');
    },
    onError: fail('Could not turn two-factor sign-in off.'),
  });

  return (
    <Card
      title="Two-factor sign-in"
      description="A code from your phone as well as your password, so a leaked password is not enough."
    >
      {isLoading || status == null ? (
        <LoadingState />
      ) : recoveryCodes != null ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-ink">
            Save these recovery codes somewhere safe. Each works once, if you lose your phone. They
            will not be shown again.
          </p>
          <ul className="tabular grid grid-cols-2 gap-1.5 rounded-md border border-line bg-canvas p-3 font-mono text-[13px]">
            {recoveryCodes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join('\n'))}
            >
              Copy
            </Button>
            <Button size="sm" variant="primary" onClick={() => setRecoveryCodes(null)}>
              I have saved them
            </Button>
          </div>
        </div>
      ) : status.enabled ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            disable.mutate();
          }}
        >
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
            <Badge tone="ok">On</Badge>
            {status.enabledAt != null && <span>since {formatRelative(status.enabledAt)}</span>}
            <span className="text-ink-faint">
              · {status.recoveryCodesRemaining} recovery code
              {status.recoveryCodesRemaining === 1 ? '' : 's'} left
            </span>
          </p>
          <p className="text-[12px] text-ink-faint">
            To turn it off, confirm your password and a current code.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Password" htmlFor="tf-password" required>
              <Input
                id="tf-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="Code" htmlFor="tf-off-code" required>
              <Input
                id="tf-off-code"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
          </div>
          <div>
            <Button type="submit" variant="danger" loading={disable.isPending}>
              Turn off
            </Button>
          </div>
        </form>
      ) : enrolment != null ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            confirm.mutate();
          }}
        >
          <p className="text-[13px] text-ink">
            Scan this with an authenticator app such as Google Authenticator, Microsoft
            Authenticator or 1Password, then enter the code it shows.
          </p>
          <div className="flex flex-wrap items-start gap-4">
            {qr != null ? (
              <img
                src={qr}
                width={176}
                height={176}
                alt="QR code for your authenticator app"
                className="rounded-md border border-line bg-white"
              />
            ) : (
              <div className="size-44 animate-pulse rounded-md bg-canvas" />
            )}
            <div className="min-w-0 flex-1 text-[12px] text-ink-faint">
              <p>Cannot scan? Enter this key instead:</p>
              <p className="mt-1 font-mono text-[13px] break-all text-ink">{enrolment.secret}</p>
            </div>
          </div>
          <Field label="Code from the app" htmlFor="tf-code" required>
            <Input
              id="tf-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={confirm.isPending}>
              Turn on
            </Button>
            <Button onClick={() => setEnrolment(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[13px] text-ink">
            <Badge tone="neutral">Off</Badge>
            You sign in with your password only.
          </p>
          <div>
            <Button variant="primary" loading={begin.isPending} onClick={() => begin.mutate()}>
              Set up two-factor sign-in
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
