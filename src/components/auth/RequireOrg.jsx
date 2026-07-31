import { Navigate } from 'react-router-dom';
import { useOrg } from '../../context/OrgContext.jsx';

/**
 * Blocks routes that need an active org. If the user has zero memberships,
 * we send them to /onboarding to create their first company workspace.
 */
export default function RequireOrg({ children }) {
  const { activeOrg, orgs, loading } = useOrg();
  if (loading) return <div style={{ padding: 32 }}>Loading workspace…</div>;
  if (!activeOrg) {
    return <Navigate to={orgs.length === 0 ? '/onboarding' : '/'} replace />;
  }
  return children;
}
