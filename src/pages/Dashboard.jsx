import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * A skinny landing page — quick counts + recent projects so the estimator
 * can see the shape of the workspace the moment they sign in. RLS scopes
 * every table to the authenticated user; no explicit filter needed here.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const [counts, setCounts] = useState({ customers: 0, projects: 0, estimates: 0, materials: 0 });
  const [recentProjects, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [c, p, e, m, recent] = await Promise.all([
        supabase.from('customers').select('id', { count: 'exact', head: true }),
        supabase.from('projects').select('id',   { count: 'exact', head: true }),
        supabase.from('estimates').select('id',  { count: 'exact', head: true }),
        supabase.from('materials').select('id',  { count: 'exact', head: true }),
        supabase.from('projects').select('id, name, status, updated_at, customer:customer_id(name)').order('updated_at', { ascending: false }).limit(6),
      ]);
      if (cancelled) return;
      setCounts({
        customers: c.count || 0,
        projects:  p.count || 0,
        estimates: e.count || 0,
        materials: m.count || 0,
      });
      setRecent(recent.data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>Dashboard</h1>
          <p>{user?.email ? `Signed in as ${user.email}` : ''}</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn primary" to="/estimates/new">+ New estimate</Link>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 20 }}>
        <StatTile label="Customers"  value={counts.customers}  to="/customers" />
        <StatTile label="Projects"   value={counts.projects}   to="/projects" />
        <StatTile label="Estimates"  value={counts.estimates}  to="/estimates" />
        <StatTile label="Materials"  value={counts.materials}  to="/materials" />
      </div>

      <div className="panel">
        <h2 style={{ marginBottom: 10 }}>Recent projects</h2>
        {loading ? (
          <div className="muted">Loading…</div>
        ) : recentProjects.length === 0 ? (
          <div className="empty">No projects yet. <Link to="/projects">Create your first project →</Link></div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th className="right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {recentProjects.map((p) => (
                  <tr key={p.id}>
                    <td><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                    <td className="muted">{p.customer?.name || '—'}</td>
                    <td><span className="pill">{p.status || 'draft'}</span></td>
                    <td className="right muted">{p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function StatTile({ label, value, to }) {
  return (
    <Link to={to} className="panel" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{value.toLocaleString()}</div>
    </Link>
  );
}
