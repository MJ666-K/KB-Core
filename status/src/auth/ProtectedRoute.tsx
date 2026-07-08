import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth, isAuthenticatedSession } from './AuthContext';
import { canAccessPath } from './permissions';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="kc-auth-loading">
        <Spin size="large" />
      </div>
    );
  }

  if (!user || !isAuthenticatedSession()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!canAccessPath(user.permissions, location.pathname)) {
    return <Navigate to="/chat" replace />;
  }

  return <Outlet />;
}
