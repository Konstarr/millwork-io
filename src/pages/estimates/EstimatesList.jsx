import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
export default function EstimatesList() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('estimates')
        .select('id, name, status, total_amount, updated_at, project:project_id(id, name, customer:customer_id(name))')
        .order('updated_at', { ascending: false });
      if (!cancelled) { setRows(data || []); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      r.name?.toLowerCase().includes(term) ||
      r.project?.name?.toLowerCase().includes(term) ||
      r.project?.customer?.name?.toLowerCase().includes(term)
    );
  }, [rows, q]);

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>Estimates</h1>
          <p>{loading ? 'Loading…' : `${filtered.length} of ${rows.length}`}</p>
        </div>
        <div className="page-head-actions">
          <button className="btn primary" onClick={() => nav('/estimates/new')}>+ New estimate</button>
        </div>
      </div>

      <div className="filter-row">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search estimate, project, or customer…" />
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {rows.length === 0
            ? <>No estimates yet. <Link to="/estimates/new">Create one →</Link></>
            : 'No estimates match this search.'}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Estimate</th>
                <th>Project</th>
                <th>Customer</th>
                <th>Status</th>
                <th className="right">Total</th>
                <th className="right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/estimates/${r.id}`}>{r.name || 'Untitled'}</Link></td>
                  <td className="muted">{r.project?.name || '—'}</td>
                  <td className="muted">{r.project?.customer?.name || '—'}</td>
                  <td><span className="pill">{r.status || 'draft'}</span></td>
                  <td className="right money">{Number(r.total_amount || 0).toFixed(2)}</td>
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
