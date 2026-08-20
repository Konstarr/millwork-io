import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
/**
 * Labor rates + shop burden settings.
 *
 * Rates are per-category (Cabinetmaker, Installer, CNC operator, etc.).
 * Burden lives on the org itself (overhead %, fringe %, default markup)
 * and is used by the estimator when nothing else is specified.
 */
const emptyRate = () => ({
  id: crypto.randomUUID(),
  _new: true,
  name: '',
  hourly_rate: 0,
  category: '',
});

/**
 * The standard millwork shop roster. One click loads every role — the
 * estimator just types the $ amounts. Default rates follow the reference
 * workbook's labor takeoff (PM 100, Drafting/Eng 40, shop trades 30,
 * Shipping 25, Install 75); everything is editable before saving.
 */
const STANDARD_ROLES = [
  { name: 'Project Management',     category: 'Office', hourly_rate: 100 },
  { name: 'Drafting',               category: 'Office', hourly_rate: 40 },
  { name: 'Engineering',            category: 'Office', hourly_rate: 40 },
  { name: 'CNC Programming',        category: 'Office', hourly_rate: 40 },
  { name: 'Saw / Panel Cutting',    category: 'Shop',   hourly_rate: 30 },
  { name: 'CNC / Machining',        category: 'Shop',   hourly_rate: 30 },
  { name: 'Edgebanding',            category: 'Shop',   hourly_rate: 30 },
  { name: 'Assembly / Benchwork',   category: 'Shop',   hourly_rate: 30 },
  { name: 'Lamination',             category: 'Shop',   hourly_rate: 30 },
  { name: 'Veneer / Pressing',      category: 'Shop',   hourly_rate: 30 },
  { name: 'Hardware',               category: 'Shop',   hourly_rate: 30 },
  { name: 'Sanding',                category: 'Shop',   hourly_rate: 30 },
  { name: 'Finishing',              category: 'Shop',   hourly_rate: 30 },
  { name: 'Shipping / Crating',     category: 'Shop',   hourly_rate: 25 },
  { name: 'Delivery',               category: 'Field',  hourly_rate: 25 },
  { name: 'Field Measure',          category: 'Field',  hourly_rate: 75 },
  { name: 'Install',                category: 'Field',  hourly_rate: 75 },
];

export default function LaborSettings() {
  const [rates, setRates] = useState([]);
  const [dirty, setDirty] = useState(new Set());
  const [deleted, setDeleted] = useState(new Set());
  const [org, setOrg]   = useState({ overhead_pct: 0, fringe_pct: 0, default_markup_pct: 15 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]   = useState('');
  const [msg, setMsg]   = useState('');

  const load = async () => {
    setLoading(true);
    const [r, o] = await Promise.all([
      supabase.from('labor_rates').select('*').order('name'),
      supabase.from('user_settings').select('overhead_pct, fringe_pct, default_markup_pct').maybeSingle(),
    ]);
    if (r.error) setErr(r.error.message);
    setRates(r.data || []);
    if (o.data) setOrg((prev) => ({ ...prev, ...o.data }));
    setDirty(new Set()); setDeleted(new Set());
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (id, k, v) => {
    setRates((rs) => rs.map((r) => r.id === id ? { ...r, [k]: v } : r));
    setDirty((d) => { const n = new Set(d); n.add(id); return n; });
  };
  const add = () => {
    const r = emptyRate();
    setRates((rs) => [r, ...rs]);
    setDirty((d) => { const n = new Set(d); n.add(r.id); return n; });
  };
  const del = (id) => {
    setDeleted((s) => { const n = new Set(s); n.add(id); return n; });
    setDirty((d) => { const n = new Set(d); n.add(id); return n; });
  };

  const setOrgField = (k, v) => setOrg((o) => ({ ...o, [k]: v }));

  // Load the standard roster as unsaved rows (skipping names that already
  // exist), so the estimator adjusts $ amounts and hits Save once.
  const loadStandardRoles = () => {
    const existing = new Set(rates.filter((r) => !deleted.has(r.id)).map((r) => r.name.toLowerCase()));
    const toAdd = STANDARD_ROLES
      .filter((s) => !existing.has(s.name.toLowerCase()))
      .map((s) => ({ id: crypto.randomUUID(), _new: true, ...s }));
    if (!toAdd.length) { setMsg('All standard roles are already in the list.'); return; }
    setRates((rs) => [...rs, ...toAdd]);
    setDirty((d) => { const n = new Set(d); toAdd.forEach((r) => n.add(r.id)); return n; });
    setMsg(`Added ${toAdd.length} standard roles — adjust the rates, then Save.`);
  };

  const saveAll = async () => {
    setSaving(true); setErr(''); setMsg('');

    // 1. shop burden settings — upsert so the first save creates the row.
    const { error: oe } = await supabase.from('user_settings').upsert({
      overhead_pct:       Number(org.overhead_pct || 0),
      fringe_pct:         Number(org.fringe_pct || 0),
      default_markup_pct: Number(org.default_markup_pct || 0),
    }, { onConflict: 'user_id' });
    if (oe) { setSaving(false); setErr(oe.message); return; }

    // 2. labor rates diff
    const toDelete = rates.filter((r) => deleted.has(r.id) && !r._new).map((r) => r.id);
    const toInsert = rates.filter((r) => r._new && !deleted.has(r.id));
    const toUpdate = rates.filter((r) => dirty.has(r.id) && !r._new && !deleted.has(r.id));

    if (toDelete.length) {
      const { error } = await supabase.from('labor_rates').delete().in('id', toDelete);
      if (error) { setSaving(false); setErr(error.message); return; }
    }
    if (toInsert.length) {
      const payload = toInsert.map((r) => ({
        name: r.name,
        hourly_rate: Number(r.hourly_rate || 0),
        category: r.category || null,
      }));
      const { error } = await supabase.from('labor_rates').insert(payload);
      if (error) { setSaving(false); setErr(error.message); return; }
    }
    for (const r of toUpdate) {
      const { error } = await supabase.from('labor_rates').update({
        name: r.name,
        hourly_rate: Number(r.hourly_rate || 0),
        category: r.category,
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
          <h1>Labor & shop settings</h1>
          <p>{loading ? 'Loading…' : 'Rates by category, plus shop-wide burden.'}</p>
        </div>
        <div className="page-head-actions">
          <button className="btn primary" onClick={saveAll} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="auth-note" style={{ marginBottom: 10 }}>{msg}</div>}

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 10 }}>Shop burden</h2>
        <div className="form-grid">
          <label>Overhead %
            <input type="number" step="0.1" value={org.overhead_pct} onChange={(e) => setOrgField('overhead_pct', e.target.value)} />
          </label>
          <label>Fringe / benefits %
            <input type="number" step="0.1" value={org.fringe_pct} onChange={(e) => setOrgField('fringe_pct', e.target.value)} />
          </label>
          <label>Default markup %
            <input type="number" step="0.1" value={org.default_markup_pct} onChange={(e) => setOrgField('default_markup_pct', e.target.value)} />
          </label>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          These are used when an estimate does not override its own markup and are shown as reference on the estimator.
        </p>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Labor rates</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm ghost" onClick={loadStandardRoles}>Load standard millwork roles</button>
            <button className="btn sm" onClick={add}>+ Add rate</button>
          </div>
        </div>

        {loading ? (
          <div className="muted">Loading…</div>
        ) : rates.filter((r) => !deleted.has(r.id)).length === 0 ? (
          <div className="panel" style={{ background: '#F5EAD6', borderColor: '#E5D6B0' }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 300px' }}>
                <h3 style={{ marginBottom: 4 }}>Start with the standard millwork roster</h3>
                <div className="muted" style={{ fontSize: 13 }}>
                  Project Management, Drafting, Engineering, CNC Programming, Saw, CNC/Machining,
                  Edgebanding, Assembly, Lamination, Veneer, Hardware, Sanding, Finishing,
                  Shipping, Delivery, Field Measure, and Install — pre-loaded, you just set the $ rates.
                </div>
              </div>
              <button className="btn primary" onClick={loadStandardRoles}>Load all 17 roles</button>
            </div>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: 180 }}>Category</th>
                  <th style={{ width: 140 }} className="right">Hourly rate</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {rates.filter((r) => !deleted.has(r.id)).map((r) => (
                  <tr key={r.id}>
                    <td><input value={r.name || ''} onChange={(e) => patch(r.id, 'name', e.target.value)} style={{ width: '100%' }} placeholder="e.g., Cabinetmaker — Journey" /></td>
                    <td><input value={r.category || ''} onChange={(e) => patch(r.id, 'category', e.target.value)} style={{ width: '100%' }} placeholder="Shop / Install / CNC" /></td>
                    <td><input type="number" step="0.01" value={r.hourly_rate} onChange={(e) => patch(r.id, 'hourly_rate', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                    <td className="right"><button className="btn sm ghost" onClick={() => del(r.id)}>×</button></td>
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
