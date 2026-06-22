// src/components/auth/ProtectedRoute.tsx
// Story: S-AUTH-04 (frontend)
// Maps to REQ: REQ-003
//
// Renders `children` when the user is authenticated; otherwise
// redirects to /login (preserving the intended destination in
// location state for post-login redirect).
//
// While the AuthProvider is still restoring the session from
// localStorage / refresh we render nothing (loading === true).

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return null; // or a spinner
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
