/** Downloads a CSV the API generates. Errors surface as a toast rather than vanishing. */
import { useState } from 'react';
import { useToast } from './ui/overlays.js';
import { Button } from './ui/primitives.js';
import { ApiError, download } from '../lib/api.js';

export function ExportButton({
  path,
  query,
  label = 'Export CSV',
}: {
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  label?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      variant="ghost"
      loading={busy}
      onClick={() => {
        setBusy(true);
        download(path, query)
          .catch((cause: unknown) =>
            toast.error(cause instanceof ApiError ? cause.message : 'Could not export.'),
          )
          .finally(() => setBusy(false));
      }}
    >
      {label}
    </Button>
  );
}
