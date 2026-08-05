import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import { computeProductCost } from '../../lib/productCost.js';

/**
 * Products = sellable assemblies (cabinets, die walls, paneling, trim…)
 * priced per LF / SF / EA. Cost rolls up live from material + labor
 * components, so the list shows current unit cost, not a stale snapshot.
 */
export default function ProductsList() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState('');
  const [cat, setCat]         = useState('all');
  const nav = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('products')
        .select(`
          id, name, category, unit, description, updated_at,
          product_materials ( qty_per_unit, waste_pct, material:material_id ( unit_cost, waste_pct ) ),
          product_labor     ( hours_per_unit, rate:labor_rate_id ( hourly_rate ) )
        `)
        .order('category', { ascending: true })
        .order('name',     { ascending: true });
      if (!cancelled) { setRows(data || []); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const cats = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category).filter(Boolean))).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (cat !== 'all' && r.category !== cat) return false;
      if (!term) return true;
      return r.name?.toLowerCase().includes(term)
          || r.description?.toLowerCase().includes(term)
          || r.category?.toLowerCase().includes(term);
    });
  }, [rows, q, cat]);

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>Products</h1>
          <p>{loading ? 'Loading…' : `${filtered.length} of ${rows.length} assemblies`}</p>
        </div>
        <div className="page-head-actions">
          <button className="btn primary" onClick={() => nav('/products/new')}>+ New product</button>
        </div>
      </div>

      <div className="filter-row">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" />
        <select className="org-switcher" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="all">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {rows.length === 0
            ? <>No products yet. Build your first assembly — a base cabinet, die wall, paneling system, or trim run. <Link to="/products/new">Create one →</Link></>
            : 'No products match these filters.'}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ width: 140 }}>Category</th>
                <th style={{ width: 60 }}>Unit</th>
                <th style={{ width: 110 }} className="right">Material / unit</th>
                <th style={{ width: 110 }} className="right">Labor / unit</th>
                <th style={{ width: 110 }} className="right">Cost / unit</th>
                <th style={{ width: 70 }} className="right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const c = computeProductCost(r);
                return (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/products/${r.id}`}>{r.name}</Link>
                      {r.description && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.description}</div>}
                    </td>
                    <td className="muted">{r.category || '—'}</td>
                    <td><span className="pill">{r.unit}</span></td>
                    <td className="right money">{c.material.toFixed(2)}</td>
                    <td className="right money">{c.labor.toFixed(2)}</td>
                    <td className="right money" style={{ fontWeight: 700 }}>{c.total.toFixed(2)}</td>
                    <td className="right">
                      <Link to={`/products/${r.id}`} className="btn sm ghost">Edit →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
