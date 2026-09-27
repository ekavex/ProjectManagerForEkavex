import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/primitives.js';

export function NotFoundPage() {
  return (
    <div className="card">
      <EmptyState
        title="That page does not exist"
        description="The link may be out of date, or the project it pointed at may have been archived."
        action={
          <Link to="/" className="text-[13px] text-accent hover:underline">
            Go to your dashboard
          </Link>
        }
      />
    </div>
  );
}
