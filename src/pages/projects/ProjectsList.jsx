import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import { useOrg } from '../../context/OrgContext.jsx';

const STATUSES = ['draft', 'bidding', 'awarded', 'in-progress', 'complete', 'lost'];

export default function ProjectsList() {
  const { activeOrg } = useOrg();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const nav = useNavigate();

  useEffect(() => {
    if (!activeOrg?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('projects')
        .select('id, name, status, bid_due, updated_at, customer:customer_id(id, name)')
        .eq('org_id', activeOrg.id)
        .order('updated_at', { ascending: false });
      if (!cancelled) { setRows(data || []); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [activeOrg?.id]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && (r.status || 'draft') !== status) return false;
      if (term && !(r.name?.toLowerCase().includes(term) || r.customer?.name?.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [rows, q, status]);

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>Projects</h1>
          <p>{loading ? 'Loading…' : `${filtered.length} of ${rows.length}`}</p>
        </div>
        <div className="page-head-actions">
          <button className="btn primary" onClick={() => nav('/projects/new')}>+ New project</button>
        </div>
      </div>

      <div className="filter-row">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project or customer…" />
        <select className="org-switcher" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {rows.length === 0
            ? <>No projects yet. <Link to="/projects/new">Start one →</Link></>
            : 'No projects match these filters.'}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Project</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Bid due</th>
                <th className="right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/projects/${r.id}`}>{r.name}</Link></td>
                  <td className="muted">{r.customer?.name || '—'}</td>
                  <td><span className="pill">{r.status || 'draft'}</span></td>
                  <td className="muted">{r.bid_due ? new Date(r.bid_due).toLocaleDateString() : '—'}</td>
                  <td className="right muted">{r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
