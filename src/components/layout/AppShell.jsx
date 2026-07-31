import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';

export default function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <TopBar />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
