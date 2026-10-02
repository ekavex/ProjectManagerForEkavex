/**
 * Routing.
 *
 * Everything except the sign-in screens sits behind `RequireAuth`. That guard is a
 * convenience for the person using the app, not a security boundary — the server refuses
 * unauthorised requests regardless of which route the browser is showing.
 *
 * The routes are code-split (Phase 19). Only the sign-in screens and the dashboard — the
 * two things every session actually starts with — are in the entry chunk; everything else
 * is fetched when it is first visited. The project screen in particular carries the Gantt,
 * which nobody looking at their notifications needs to have downloaded.
 */
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from './components/ui/primitives.js';
import { useAuth } from './features/auth/AuthProvider.js';
import { AppShell } from './layouts/AppShell.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { LoginPage } from './pages/auth/LoginPage.js';

/** Named exports, so each lazy import re-shapes the module into the default React expects. */
const AuditPage = lazy(() =>
  import('./pages/admin/AuditPage.js').then((m) => ({ default: m.AuditPage })),
);
const NotificationRulesPage = lazy(() =>
  import('./pages/admin/NotificationRulesPage.js').then((m) => ({
    default: m.NotificationRulesPage,
  })),
);
const OrganizationPage = lazy(() =>
  import('./pages/admin/OrganizationPage.js').then((m) => ({ default: m.OrganizationPage })),
);
const RolesPage = lazy(() =>
  import('./pages/admin/RolesPage.js').then((m) => ({ default: m.RolesPage })),
);
const CalendarPage = lazy(() =>
  import('./pages/CalendarPage.js').then((m) => ({ default: m.CalendarPage })),
);
const LeavePage = lazy(() =>
  import('./pages/LeavePage.js').then((m) => ({ default: m.LeavePage })),
);
const PeoplePage = lazy(() =>
  import('./pages/admin/PeoplePage.js').then((m) => ({ default: m.PeoplePage })),
);
const AttendancePage = lazy(() =>
  import('./pages/AttendancePage.js').then((m) => ({ default: m.AttendancePage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/auth/ForgotPasswordPage.js').then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/auth/ResetPasswordPage.js').then((m) => ({ default: m.ResetPasswordPage })),
);
const MyWorkPage = lazy(() =>
  import('./pages/MyWorkPage.js').then((m) => ({ default: m.MyWorkPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage.js').then((m) => ({ default: m.NotFoundPage })),
);
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage.js').then((m) => ({ default: m.NotificationsPage })),
);
const ProjectPage = lazy(() =>
  import('./pages/project/ProjectPage.js').then((m) => ({ default: m.ProjectPage })),
);
const ProjectsPage = lazy(() =>
  import('./pages/ProjectsPage.js').then((m) => ({ default: m.ProjectsPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage.js').then((m) => ({ default: m.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage.js').then((m) => ({ default: m.SettingsPage })),
);
const TeamPage = lazy(() => import('./pages/TeamPage.js').then((m) => ({ default: m.TeamPage })));

/** What a route chunk shows while it is on the wire. */
function RouteFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-ink-faint">
      <Spinner size={22} />
    </div>
  );
}

export function App() {
  const { user, initialising } = useAuth();

  if (initialising) {
    return (
      <div className="grid min-h-screen place-items-center text-ink-faint">
        <Spinner size={22} />
      </div>
    );
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={user == null ? <LoginPage /> : <Navigate to="/" replace />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route
          path="*"
          element={
            <RequireAuth>
              <AppShell>
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/my-work" element={<MyWorkPage />} />
                    <Route path="/my-work/notes/:noteId" element={<MyWorkPage />} />
                    <Route path="/projects" element={<ProjectsPage />} />
                    <Route path="/projects/:projectId/*" element={<ProjectPage />} />
                    <Route path="/team" element={<TeamPage />} />
                    <Route path="/team/:userId" element={<TeamPage />} />
                    <Route path="/attendance" element={<AttendancePage />} />
                    <Route path="/leave" element={<LeavePage />} />
                    <Route path="/calendar" element={<CalendarPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/notifications" element={<NotificationsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/admin/users" element={<PeoplePage />} />
                    <Route path="/admin/organization" element={<OrganizationPage />} />
                    <Route path="/admin/roles" element={<RolesPage />} />
                    <Route path="/admin/notifications" element={<NotificationRulesPage />} />
                    <Route path="/admin/audit" element={<AuditPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Suspense>
              </AppShell>
            </RequireAuth>
          }
        />
      </Routes>
    </Suspense>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (user == null) {
    // Remember where they were heading so the login can send them back there.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}
