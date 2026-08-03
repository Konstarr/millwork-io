import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useOrg } from '../../context/OrgContext.jsx';

/**
 * Materials Library — millwork.io
 *
 * Two data sources live behind this page:
 *   1. public.materials         (org-scoped; the estimator's real library)
 *   2. public.starter_materials (global; a 9,273-row seed catalog copied
 *      from a real millwork estimating workbook). On first visit for an
 *      empty workspace we surface a one-click "Import starter library"
 *      CTA that calls the import_starter_materials RPC.
 *
 * Row shape matches the reference workbook:
 *   Product Name, Item #, Manufacturer, Description, Finish, Category,
 *   UoM (EA/SF/LF/BF), Unit Cost, Waste %, Supplier, Notes.
 */

const emptyRow = () => ({
  id: crypto.randomUUID(),
  _new: true,
  name: '',
  item_number: '',
  manufacturer: '',
  description: '',
  finish: '',
  category: '',
  unit: 'EA',
  unit_cost: 0,
  waste_pct: 0,
  supplier: '',
  notes: '',
});

// Paginate the display — 9,273 rows in one <tbody> would tank scroll perf.
const PAGE_SIZE = 100;

export default function MaterialsLibrary() {
  const { activeOrg } = useOrg();
  const [rows, setRows]         = useState([]);
  const [dirty, setDirty]       = useState(new Set());
  const [deleted, setDeleted]   = useState(new Set());
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [importing, setImp]     = useState(false);
  const [q, setQ]               = useState('');
  const [cat, setCat]           = useState('all');
  const [mfr, setMfr]           = useState('all');
  const [unit, setUnit]         = useState('all');
  const [page, setPage]         = useState(1);
  const [err, setErr]           = useState('');
  const [msg, setMsg]           = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('materials')
      .select('*')
      .eq('org_id', activeOrg.id)
      .order('category', { ascending: true })
      .order('name',     { ascending: true })
      .limit(20000);
    if (error) setErr(error.message);
    setRows(data || []);
    setDirty(new Set()); setDeleted(new Set()); setPage(1);
    setLoading(false);
  };

  useEffect(() => {
    if (activeOrg?.id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id]);

  // Reset to page 1 whenever a filter changes so the user isn't stranded on
  // page 42 of a filtered set that only has 3 pages.
  useEffect(() => { setPage(1); }, [q, cat, mfr, unit]);

  // Distinct dropdown values, derived from current rows.
  const [cats, mfrs, units] = useMemo(() => {
    const cs = new Set(), ms = new Set(), us = new Set();
    for (const r of rows) {
      if (deleted.has(r.id)) continue;
      if (r.category)     cs.add(r.category);
      if (r.manufacturer) ms.add(r.manufacturer);
      if (r.unit)         us.add(r.unit);
    }
    return [
      Array.from(cs).sort(),
      Array.from(ms).sort(),
      Array.from(us).sort(),
    ];
  }, [rows, deleted]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (deleted.has(r.id)) return false;
      if (cat  !== 'all' && r.category     !== cat)  return false;
      if (mfr  !== 'all' && r.manufacturer !== mfr)  return false;
      if (unit !== 'all' && r.unit         !== unit) return false;
      if (!term) return true;
      return r.name?.toLowerCase().includes(term)
          || r.description?.toLowerCase().includes(term)
          || r.item_number?.toLowerCase().includes(term)
          || r.manufacturer?.toLowerCase().includes(term)
          || r.finish?.toLowerCase().includes(term);
    });
  }, [rows, q, cat, mfr, unit, deleted]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const patch = (id, k, v) => {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, [k]: v } : r));
    setDirty((d) => { const n = new Set(d); n.add(id); return n; });
  };

  const addRow = () => {
    const row = emptyRow();
    setRows((rs) => [row, ...rs]);
    setDirty((d) => { const n = new Set(d); n.add(row.id); return n; });
    setPage(1);
  };

  const del = (id) => {
    setDeleted((s) => { const n = new Set(s); n.add(id); return n; });
    setDirty((d) => { const n = new Set(d); n.add(id); return n; });
  };

  const importStarter = async () => {
    if (!activeOrg?.id) return;
    setImp(true); setErr(''); setMsg('');
    const { data, error } = await supabase.rpc('import_starter_materials', { org_in: activeOrg.id });
    setImp(false);
    if (error) { setErr(error.message); return; }
    setMsg(`Imported ${data ?? 0} materials from the starter library.`);
    await load();
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
        name: r.name,
        item_number:  r.item_number  || null,
        manufacturer: r.manufacturer || null,
        description:  r.description  || null,
        finish:       r.finish       || null,
        category:     r.category     || null,
        unit:         r.unit         || 'EA',
        unit_cost:    Number(r.unit_cost || 0),
        waste_pct:    Number(r.waste_pct || 0),
        supplier:     r.supplier || null,
        notes:        r.notes    || null,
      }));
      const { error } = await supabase.from('materials').insert(payload);
      if (error) { setSaving(false); setErr(error.message); return; }
    }
    for (const r of toUpdate) {
      const { error } = await supabase.from('materials').update({
        name: r.name, item_number: r.item_number, manufacturer: r.manufacturer,
        description: r.description, finish: r.finish, category: r.category,
        unit: r.unit, unit_cost: Number(r.unit_cost || 0),
        waste_pct: Number(r.waste_pct || 0), supplier: r.supplier, notes: r.notes,
      }).eq('id', r.id);
      if (error) { setSaving(false); setErr(error.message); return; }
    }
    setSaving(false); setMsg('Saved.');
    await load();
  };

  const visibleCount = rows.length - deleted.size;

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>Materials</h1>
          <p>
            {loading
              ? 'Loading…'
              : `${filtered.length.toLocaleString()} match${filtered.length === 1 ? '' : 'es'} of ${visibleCount.toLocaleString()} materials`
            }
          </p>
        </div>
        <div className="page-head-actions">
          <button className="btn ghost" onClick={addRow}>+ Add material</button>
          <button className="btn primary" onClick={saveAll} disabled={saving || dirty.size === 0}>
            {saving ? 'Saving…' : `Save${dirty.size ? ` (${dirty.size})` : ''}`}
          </button>
        </div>
      </div>

      {/* Empty-library CTA — vanishes once the estimator has any rows. */}
      {!loading && visibleCount === 0 && (
        <div className="panel" style={{ marginBottom: 16, background: '#F5EAD6', borderColor: '#E5D6B0' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px' }}>
              <h2 style={{ marginBottom: 4 }}>Start with 9,273 pre-loaded materials</h2>
              <div className="muted" style={{ fontSize: 13 }}>
                Hardware, laminates, solid surface, sheet goods, hardwoods, edgebanding, veneers, trim,
                fabric and glass — Amerock, Formica, Berenson, Hafele, Corian, Wilsonart, Blum and 60+ more brands.
                You can edit or delete anything after import.
              </div>
            </div>
            <button className="btn primary" onClick={importStarter} disabled={importing}>
              {importing ? 'Importing…' : 'Import starter library'}
            </button>
          </div>
        </div>
      )}

      <div className="filter-row">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, description, item #, manufacturer, or finish…"
        />
        <select className="org-switcher" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="all">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="org-switcher" value={mfr} onChange={(e) => setMfr(e.target.value)}>
          <option value="all">All manufacturers</option>
          {mfrs.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="org-switcher" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="all">All units</option>
          {units.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="auth-note" style={{ marginBottom: 10 }}>{msg}</div>}

      {loading ? (
        <div className="muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {visibleCount === 0
            ? 'No materials yet. Import the starter library above, or click + Add material.'
            : 'No materials match these filters.'}
        </div>
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Item #</th>
                  <th style={{ width: 130 }}>Manufacturer</th>
                  <th>Description</th>
                  <th style={{ width: 90 }}>Finish</th>
                  <th style={{ width: 130 }}>Category</th>
                  <th style={{ width: 60 }}>UoM</th>
                  <th style={{ width: 100 }} className="right">Unit cost</th>
                  <th style={{ width: 80 }} className="right">Waste %</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id}>
                    <td><input value={r.item_number || ''} onChange={(e) => patch(r.id, 'item_number', e.target.value)} style={{ width: '100%' }} /></td>
                    <td><input value={r.manufacturer || ''} onChange={(e) => patch(r.id, 'manufacturer', e.target.value)} style={{ width: '100%' }} /></td>
                    <td>
                      <input
                        value={r.description || r.name || ''}
                        onChange={(e) => patch(r.id, 'description', e.target.value)}
                        style={{ width: '100%' }}
                        placeholder="e.g., Blum Blumotion 110° soft close hinge"
                      />
                    </td>
                    <td><input value={r.finish || ''} onChange={(e) => patch(r.id, 'finish', e.target.value)} style={{ width: '100%' }} /></td>
                    <td><input value={r.category || ''} onChange={(e) => patch(r.id, 'category', e.target.value)} style={{ width: '100%' }} /></td>
                    <td>
                      <select value={r.unit || 'EA'} onChange={(e) => patch(r.id, 'unit', e.target.value)} style={{ width: '100%' }}>
                        <option>EA</option><option>SF</option><option>LF</option><option>BF</option>
                        {r.unit && !['EA','SF','LF','BF'].includes(r.unit) && <option>{r.unit}</option>}
                      </select>
                    </td>
                    <td><input type="number" step="0.01" value={r.unit_cost} onChange={(e) => patch(r.id, 'unit_cost', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                    <td><input type="number" step="0.1"  value={r.waste_pct} onChange={(e) => patch(r.id, 'waste_pct', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                    <td className="right"><button className="btn sm ghost" onClick={() => del(r.id)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
              <div>Page {page} of {pageCount}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm ghost" onClick={() => setPage(1)}                       disabled={page === 1}>«</button>
                <button className="btn sm ghost" onClick={() => setPage((p) => Math.max(1, p-1))} disabled={page === 1}>‹ prev</button>
                <button className="btn sm ghost" onClick={() => setPage((p) => Math.min(pageCount, p+1))} disabled={page === pageCount}>next ›</button>
                <button className="btn sm ghost" onClick={() => setPage(pageCount)}               disabled={page === pageCount}>»</button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
