import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useOrg } from '../../context/OrgContext.jsx';

/**
 * Simple inline-editable material catalog. Each row is its own record.
 * The estimator can add new rows, tweak a few cells, then hit Save.
 */
const emptyRow = () => ({
  id: crypto.randomUUID(),
  _new: true,
  sku: '',
  name: '',
  category: '',
  unit: 'ea',
  unit_cost: 0,
  waste_pct: 0,
  supplier: '',
  notes: '',
});

export default function MaterialsLibrary() {
  const { activeOrg } = useOrg();
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(new Set());
  const [deleted, setDeleted] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('materials')
      .select('*')
      .eq('org_id', activeOrg.id)
      .order('name', { ascending: true });
    if (error) setErr(error.message);
    setRows(data || []);
    setDirty(new Set()); setDeleted(new Set());
    setLoading(false);
  };

  useEffect(() => {
    if (activeOrg?.id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (deleted.has(r.id)) return false;
      if (!term) return true;
      return r.name?.toLowerCase().includes(term) ||
             r.sku?.toLowerCase().includes(term) ||
             r.category?.toLowerCase().includes(term) ||
             r.supplier?.toLowerCase().includes(term);
    });
  }, [rows, q, deleted]);

  const patch = (id, k, v) => {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, [k]: v } : r));
    setDirty((d) => { const n = new Set(d); n.add(id); return n; });
  };

  const addRow = () => {
    const row = emptyRow();
    setRows((rs) => [row, ...rs]);
    setDirty((d) => { const n = new Set(d); n.add(row.id); return n; });
  };

  const del = (id) => {
    setDeleted((s) => { const n = new Set(s); n.add(id); return n; });
    setDirty((d) => { const n = new Set(d); n.add(id); return n; });
  };

  const saveAll = async () => {
    setSaving(true); setErr(''); setMsg('');
    const toDelete = rows.filter((r) => deleted.has(r.id) && !r._new).map((r) => r.id);
    const toInsert = rows.filter((r) => r._new && !deleted.has(r.id));
    const toUpdate = rows.filter((r) => dirty.has(r.id) && !r._new && !deleted.has(r.id));

    if (toDelete.length) {
      const { error } = await supabase.from('materials').delete().in('id', toDelete);
      if (error) { setSaving(false); setErr(error.message); return; }
    }
    if (toInsert.length) {
      const payload = toInsert.map((r) => ({
        org_id: activeOrg.id,
        sku: r.sku || null,
        name: r.name,
        category: r.category || null,
        unit: r.unit || 'ea',
        unit_cost: Number(r.unit_cost || 0),
        waste_pct: Number(r.waste_pct || 0),
        supplier: r.supplier || null,
        notes: r.notes || null,
      }));
      const { error } = await supabase.from('materials').insert(payload);
      if (error) { setSaving(false); setErr(error.message); return; }
    }
    for (const r of toUpdate) {
      const { error } = await supabase.from('materials').update({
        sku: r.sku, name: r.name, category: r.category, unit: r.unit,
        unit_cost: Number(r.unit_cost || 0), waste_pct: Number(r.waste_pct || 0),
        supplier: r.supplier, notes: r.notes,
      }).eq('id', r.id);
      if (error) { setSaving(false); setErr(error.message); return; }
    }
    setSaving(false); setMsg('Saved.');
    await load();
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>Materials</h1>
          <p>{loading ? 'Loading…' : `${filtered.length} of ${rows.length - deleted.size}`}</p>
        </div>
        <div className="page-head-actions">
          <button className="btn ghost" onClick={addRow}>+ Add material</button>
          <button className="btn primary" onClick={saveAll} disabled={saving || dirty.size === 0}>
            {saving ? 'Saving…' : `Save${dirty.size ? ` (${dirty.size})` : ''}`}
          </button>
        </div>
      </div>

      <div className="filter-row">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, name, category, or supplier…" />
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="auth-note" style={{ marginBottom: 10 }}>{msg}</div>}

      {loading ? (
        <div className="muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No materials yet. Click <b>+ Add material</b> to start your library.</div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 120 }}>SKU</th>
                <th>Name</th>
                <th style={{ width: 140 }}>Category</th>
                <th style={{ width: 70 }}>Unit</th>
                <th style={{ width: 110 }} className="right">Unit cost</th>
                <th style={{ width: 90 }} className="right">Waste %</th>
                <th style={{ width: 160 }}>Supplier</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><input value={r.sku || ''} onChange={(e) => patch(r.id, 'sku', e.target.value)} style={{ width: '100%' }} /></td>
                  <td><input value={r.name || ''} onChange={(e) => patch(r.id, 'name', e.target.value)} style={{ width: '100%' }} placeholder="e.g., 3/4 Prefinished Maple Ply" /></td>
                  <td><input value={r.category || ''} onChange={(e) => patch(r.id, 'category', e.target.value)} style={{ width: '100%' }} /></td>
                  <td><input value={r.unit || ''} onChange={(e) => patch(r.id, 'unit', e.target.value)} style={{ width: '100%' }} /></td>
                  <td><input type="number" step="0.01" value={r.unit_cost} onChange={(e) => patch(r.id, 'unit_cost', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                  <td><input type="number" step="0.1" value={r.waste_pct} onChange={(e) => patch(r.id, 'waste_pct', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                  <td><input value={r.supplier || ''} onChange={(e) => patch(r.id, 'supplier', e.target.value)} style={{ width: '100%' }} /></td>
                  <td className="right"><button className="btn sm ghost" onClick={() => del(r.id)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
