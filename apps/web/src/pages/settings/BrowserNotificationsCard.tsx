import { useState } from 'react';
import { Badge, Button, Card } from '../../components/ui/primitives.js';
import {
  browserNotificationsEnabled,
  browserNotificationsSupported,
  setBrowserNotifications,
} from '../../lib/browser-notifications.js';

/** Desktop alerts while Ekavist is open in another tab. Remembered on this device only. */
export function BrowserNotificationsCard() {
  const [enabled, setEnabled] = useState(browserNotificationsEnabled);
  const [blocked, setBlocked] = useState(
    browserNotificationsSupported() && window.Notification.permission === 'denied',
  );

  return (
    <Card
      title="Browser notifications"
      description="An alert on this computer when something new arrives while Ekavist is in the background."
    >
      {!browserNotificationsSupported() ? (
        <p className="text-[13px] text-ink-faint">This browser does not support notifications.</p>
      ) : blocked ? (
        <p className="text-[13px] text-ink-faint">
          Notifications are blocked for this site. Allow them in the browser&apos;s site settings,
          then come back here.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? 'On' : 'Off'}</Badge>
          <Button
            size="sm"
            onClick={() => {
              void setBrowserNotifications(!enabled).then((on) => {
                setEnabled(on);
                setBlocked(window.Notification.permission === 'denied');
              });
            }}
          >
            {enabled ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      )}
    </Card>
  );
}
