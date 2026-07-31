import { useNavigate } from 'react-router-dom';
import { useOrg } from '../../context/OrgContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { signOut } from '../../context/AuthContext.jsx';

export default function TopBar() {
  const { orgs, activeOrg, setActiveOrg } = useOrg();
  const { user } = useAuth();
  const nav = useNavigate();

  const onSwitch = (e) => {
    const org = orgs.find((o) => o.id === e.target.value);
    if (org) setActiveOrg(org);
  };

  const onSignOut = async () => {
    await signOut();
    nav('/login', { replace: true });
  };

  return (
    <header className="app-topbar">
      <div className="app-topbar-left">
        {orgs.length > 0 && (
          <select
            className="org-switcher"
            value={activeOrg?.id || ''}
            onChange={onSwitch}
            title="Switch workspace"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
        {activeOrg && (
          <span className="muted" style={{ fontSize: 12 }}>
            role: {activeOrg.role || 'member'}
          </span>
        )}
      </div>
      <div className="app-topbar-right user-menu">
        <span>{user?.email}</span>
        <button className="btn sm ghost" onClick={onSignOut}>Sign out</button>
      </div>
    </header>
  );
}
