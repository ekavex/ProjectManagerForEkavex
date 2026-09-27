/**
 * Personal settings: profile, notification preferences and password.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useToast } from '../components/ui/overlays.js';
import { PageHeader } from '../components/ui/page.js';
import { Badge, Button, Card, Checkbox, Field, Input } from '../components/ui/primitives.js';
import { useAuth } from '../features/auth/AuthProvider.js';
import { ApiError, api } from '../lib/api.js';
import { humanise } from '../lib/format.js';

const PREFERENCES: { key: string; label: string; description: string }[] = [
  {
    key: 'emailOnTaskAssigned',
    label: 'A task is assigned to me',
    description: 'Sent as soon as someone assigns you work.',
  },
  {
    key: 'emailOnTaskDueSoon',
    label: 'A task of mine is due soon',
    description: 'Follows the reminder schedule your administrator has configured.',
  },
  { key: 'emailOnTaskOverdue', label: 'A task of mine is overdue', description: '' },
  { key: 'emailOnMention', label: 'Somebody mentions me in chat', description: '' },
  { key: 'emailOnProjectAssigned', label: 'I am added to a project', description: '' },
  {
    key: 'emailOnPhaseDecision',
    label: 'A phase is submitted, approved or rejected',
    description: '',
  },
  {
    key: 'emailDailySummary',
    label: 'A daily summary of my work',
    description: 'One message at the end of the working day. Off by default.',
  },
  {
    key: 'emailWeeklySummary',
    label: 'A weekly summary for each of my projects',
    description: '',
  },
];

export function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();

  if (user == null) return null;

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Your profile, what Ekavist emails you about, and your password."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileCard
          user={user}
          onSaved={(updated) => {
            refreshUser({ ...user, ...updated });
            toast.success('Profile saved.');
          }}
        />
        <PreferencesCard preferences={user.notificationPreferences} />
        <PasswordCard />
        <Card title="Account">
          <dl className="grid gap-3 text-[13px]">
            <div>
              <dt className="text-[11px] tracking-wide text-ink-faint uppercase">Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-wide text-ink-faint uppercase">
                Organisation role
              </dt>
              <dd>
                <Badge tone="accent">{humanise(user.role)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-wide text-ink-faint uppercase">Organisation</dt>
              <dd>
                {user.organization.name} · {user.organization.timezone}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-wide text-ink-faint uppercase">Working day</dt>
              <dd>
                Starts {user.organization.workdayStart}; arriving after{' '}
                {user.organization.lateAfter} is recorded as late.
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  );
}

function ProfileCard({
  user,
  onSaved,
}: {
  user: { fullName: string; phone: string | null; timezone: string; skills: string[] };
  onSaved: (updated: Record<string, unknown>) => void;
}) {
  const toast = useToast();
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [timezone, setTimezone] = useState(user.timezone);
  const [skills, setSkills] = useState(user.skills.join(', '));

  const save = useMutation({
    mutationFn: () =>
      api.patch('/users/me', {
        fullName,
        phone: phone === '' ? undefined : phone,
        timezone,
        skills: skills
          .split(',')
          .map((skill) => skill.trim())
          .filter((skill) => skill !== ''),
      }),
    onSuccess: () => onSaved({ fullName, phone: phone === '' ? null : phone, timezone }),
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not save your profile.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Card title="Profile">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Full name" htmlFor="profile-name" required>
          <Input
            id="profile-name"
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </Field>
        <Field label="Phone" htmlFor="profile-phone">
          <Input
            id="profile-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>
        <Field
          label="Timezone"
          htmlFor="profile-timezone"
          hint="Dates and times are shown in this zone. Due dates follow the organisation's zone."
        >
          <Input
            id="profile-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="Asia/Kolkata"
          />
        </Field>
        <Field label="Skills" htmlFor="profile-skills" hint="Separated by commas.">
          <Input
            id="profile-skills"
            value={skills}
            onChange={(event) => setSkills(event.target.value)}
          />
        </Field>
        <Button variant="primary" type="submit" loading={save.isPending} className="self-start">
          Save profile
        </Button>
      </form>
    </Card>
  );
}

function PreferencesCard({ preferences }: { preferences: Record<string, boolean> }) {
  const toast = useToast();
  const [values, setValues] = useState(preferences);

  const save = useMutation({
    mutationFn: (next: Record<string, boolean>) =>
      api.patch('/users/me/notification-preferences', next),
    onSuccess: () => toast.success('Preferences saved.'),
    onError: () => toast.error('Could not save your preferences.'),
  });

  const toggle = (key: string, value: boolean): void => {
    const next = { ...values, [key]: value };
    setValues(next);
    save.mutate({ [key]: value });
  };

  return (
    <Card
      title="Email notifications"
      description="In-app notifications are always on. These control what also reaches your inbox."
    >
      <div className="flex flex-col gap-3">
        {PREFERENCES.map((preference) => (
          <Checkbox
            key={preference.key}
            label={preference.label}
            {...(preference.description !== '' ? { description: preference.description } : {})}
            checked={values[preference.key] === true}
            onChange={(event) => toggle(preference.key, event.target.checked)}
          />
        ))}
      </div>
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const { signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      toast.success('Password changed. You will be signed out of other devices.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      // Changing a password revokes every session, including this one.
      void signOut();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof ApiError ? cause.message : 'Could not change your password.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError('The two new passwords do not match.');
      return;
    }
    setError(null);
    change.mutate();
  };

  return (
    <Card title="Password" description="Changing it signs you out everywhere, including here.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error != null && (
          <div
            className="rounded-md border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
            role="alert"
          >
            {error}
          </div>
        )}
        <Field label="Current password" htmlFor="current-password" required>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field label="New password" htmlFor="new-password" required hint="At least 10 characters.">
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        <Field label="Confirm the new password" htmlFor="confirm-password" required>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>
        <Button variant="primary" type="submit" loading={change.isPending} className="self-start">
          Change password
        </Button>
      </form>
    </Card>
  );
}
