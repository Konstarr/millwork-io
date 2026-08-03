import { useNavigate } from 'react-router-dom';
import { useAuth, signOut } from '../../context/AuthContext.jsx';

export default function TopBar() {
  const { user } = useAuth();
  const nav = useNavigate();

  const onSignOut = async () => {
    await signOut();
    nav('/login', { replace: true });
  };

  return (
    <header className="app-topbar">
      <div className="app-topbar-left" />
      <div className="app-topbar-right user-menu">
        <span>{user?.email}</span>
        <button className="btn sm ghost" onClick={onSignOut}>Sign out</button>
      </div>
    </header>
  );
}
