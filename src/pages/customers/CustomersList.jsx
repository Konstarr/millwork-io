import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import { useOrg } from '../../context/OrgContext.jsx';

export default function CustomersList() {
  const { activeOrg } = useOrg();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    if (!activeOrg?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('customers')
        .select('id, name, contact_name, email, phone, city, state, updated_at')
        .eq('org_id', activeOrg.id)
        .order('name', { ascending: true });
      if (!cancelled) { setRows(data || []); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [activeOrg?.id]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      r.name?.toLowerCase().includes(term) ||
      r.contact_name?.toLowerCase().includes(term) ||
      r.email?.toLowerCase().includes(term) ||
      r.city?.toLowerCase().includes(term)
    );
  }, [rows, q]);

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>Customers</h1>
          <p>{loading ? 'Loading…' : `${filtered.length} of ${rows.length}`}</p>
        </div>
        <div className="page-head-actions">
          <button className="btn primary" onClick={() => nav('/customers/new')}>+ New customer</button>
        </div>
      </div>

      <div className="filter-row">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, contact, email, or city…"
        />
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {rows.length === 0
            ? <>No customers yet. <Link to="/customers/new">Add your first →</Link></>
            : 'No customers match this search.'}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Location</th>
                <th className="right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/customers/${r.id}`}>{r.name}</Link></td>
                  <td className="muted">{r.contact_name || '—'}</td>
                  <td className="muted">{r.email || '—'}</td>
                  <td className="muted">{r.phone || '—'}</td>
                  <td className="muted">{[r.city, r.state].filter(Boolean).join(', ') || '—'}</td>
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
