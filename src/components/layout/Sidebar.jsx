import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/',           label: 'Dashboard',   icon: '⌂', end: true }, // ⌂
  { to: '/customers',  label: 'Customers',   icon: '◎' }, // ◎
  { to: '/projects',   label: 'Projects',    icon: '▣' }, // ▣
  { to: '/estimates',  label: 'Estimating',  icon: '∑' }, // ∑
  { to: '/materials',  label: 'Materials',   icon: '▦' }, // ▦
  { to: '/labor',      label: 'Labor',       icon: '⚙' }, // ⚙
];

export default function Sidebar() {
  return (
    <aside className="app-sidebar">
      <h1>millwork.io</h1>
      <nav>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
