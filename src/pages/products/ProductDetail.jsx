import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';

/**
 * Product editor — define an assembly (cabinet, die wall, paneling, trim…)
 * priced per LF / SF / EA, with two component lists:
 *
 *   Materials — "per 1 <unit>, consume <qty> of <material> (+waste%)"
 *   Labor     — "per 1 <unit>, spend <hours> of <trade>"
 *
 * The right rail shows the live rollup. Materials are picked through a
 * search box (the library is 9k+ rows — a dropdown would be useless).
 */

const CATEGORY_SUGGESTIONS = ['Cabinets', 'Die Walls', 'Paneling', 'Trim', 'Countertops', 'Closets', 'Doors', 'Specialty'];

export default function ProductDetail() {
  const { id } = useParams();
  const isNew  = !id || id === 'new';
  const nav    = useNavigate();

  const [form, setForm] = useState({ name: '', category: '', unit: 'LF', description: '', notes: '' });
  const [mats, setMats]     = useState([]);  // product_materials rows (joined w/ material)
  const [labor, setLabor]   = useState([]);  // product_labor rows (joined w/ rate)
  const [rates, setRates]   = useState([]);  // labor_rates lookup
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving]   = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // material search box state
  const [matQ, setMatQ]           = useState('');
  const [matResults, setMatResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lr = await supabase.from('labor_rates').select('id, name, hourly_rate').order('name');
      if (!cancelled) setRates(lr.data || []);

      if (isNew) { setLoading(false); return; }
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name, category, unit, description, notes,
          product_materials ( id, qty_per_unit, waste_pct, sort_order,
            material:material_id ( id, name, description, manufacturer, category, unit, unit_cost, waste_pct ) ),
          product_labor ( id, hours_per_unit, sort_order,
            rate:labor_rate_id ( id, name, hourly_rate ) )
        `)
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (error) { setErr(error.message); setLoading(false); return; }
      if (data) {
        setForm({
          name: data.name || '', category: data.category || '',
          unit: data.unit || 'LF', description: data.description || '', notes: data.notes || '',
        });
        setMats((data.product_materials || []).sort((a, b) => a.sort_order - b.sort_order));
        setLabor((data.product_labor || []).sort((a, b) => a.sort_order - b.sort_order));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, isNew]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // ---- material search (server-side, 20 hits) ----
  useEffect(() => {
    const term = matQ.trim();
    if (term.length < 2) { setMatResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('materials')
        .select('id, name, description, manufacturer, category, unit, unit_cost, waste_pct')
        .or(`name.ilike.%${term}%,description.ilike.%${term}%,manufacturer.ilike.%${term}%`)
        .limit(20);
      if (!cancelled) { setMatResults(data || []); setSearching(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [matQ]);

  const addMaterial = (m) => {
    setMats((ms) => [...ms, {
      id: `new_${crypto.randomUUID()}`,
      _new: true,
      qty_per_unit: 1,
      waste_pct: 0,
      sort_order: ms.length,
      material: m,
    }]);
    setMatQ(''); setMatResults([]);
  };

  const addLaborRow = () => {
    if (!rates.length) { setErr('Add labor rates first (Labor page) so products can consume trade hours.'); return; }
    setLabor((ls) => [...ls, {
      id: `new_${crypto.randomUUID()}`,
      _new: true,
      hours_per_unit: 0,
      sort_order: ls.length,
      rate: rates[0],
    }]);
  };

  const patchMat   = (rid, k, v) => setMats((ms) => ms.map((r) => r.id === rid ? { ...r, [k]: v } : r));
  const patchLabor = (rid, k, v) => setLabor((ls) => ls.map((r) => r.id === rid ? { ...r, [k]: v } : r));
  const dropMat    = (rid) => setMats((ms) => ms.filter((r) => r.id !== rid));
  const dropLabor  = (rid) => setLabor((ls) => ls.filter((r) => r.id !== rid));

  // ---- live rollup ----
  const rollup = useMemo(() => {
    const material = mats.reduce((s, pm) => {
      const waste = Number(pm.waste_pct || 0) > 0 ? Number(pm.waste_pct) : Number(pm.material?.waste_pct || 0);
      return s + Number(pm.qty_per_unit || 0) * Number(pm.material?.unit_cost || 0) * (1 + waste / 100);
    }, 0);
    const laborCost = labor.reduce((s, pl) =>
      s + Number(pl.hours_per_unit || 0) * Number(pl.rate?.hourly_rate || 0), 0);
    return { material, labor: laborCost, total: material + laborCost };
  }, [mats, labor]);

  const save = async (e) => {
    e?.preventDefault();
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    setSaving(true); setErr(''); setMsg('');

    let productId = id;
    if (isNew) {
      const { data, error } = await supabase.from('products').insert(form).select('id').single();
      if (error) { setSaving(false); setErr(error.message); return; }
      productId = data.id;
    } else {
      const { error } = await supabase.from('products').update(form).eq('id', id);
      if (error) { setSaving(false); setErr(error.message); return; }
    }

    // Wipe + reinsert components — simple and safe at this scale.
    await supabase.from('product_materials').delete().eq('product_id', productId);
    await supabase.from('product_labor').delete().eq('product_id', productId);

    if (mats.length) {
      const { error } = await supabase.from('product_materials').insert(
        mats.map((pm, i) => ({
          product_id: productId,
          material_id: pm.material.id,
          qty_per_unit: Number(pm.qty_per_unit || 0),
          waste_pct: Number(pm.waste_pct || 0),
          sort_order: i,
        }))
      );
      if (error) { setSaving(false); setErr(error.message); return; }
    }
    if (labor.length) {
      const { error } = await supabase.from('product_labor').insert(
        labor.map((pl, i) => ({
          product_id: productId,
          labor_rate_id: pl.rate.id,
          hours_per_unit: Number(pl.hours_per_unit || 0),
          sort_order: i,
        }))
      );
      if (error) { setSaving(false); setErr(error.message); return; }
    }

    setSaving(false);
    if (isNew) nav(`/products/${productId}`, { replace: true });
    else setMsg('Saved.');
  };

  const remove = async () => {
    if (!confirm('Delete this product? Estimates that used it keep their snapshot lines.')) return;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    nav('/products', { replace: true });
  };

  if (loading) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>{isNew ? 'New product' : form.name || 'Product'}</h1>
          <p><Link to="/products">← All products</Link></p>
        </div>
        <div className="page-head-actions">
          {!isNew && <button className="btn ghost" onClick={remove}>Delete</button>}
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : (isNew ? 'Create product' : 'Save product')}
          </button>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="auth-note" style={{ marginBottom: 10 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 16, alignItems: 'start' }}>
        <div className="stack">
          {/* ---- header form ---- */}
          <div className="panel">
            <div className="form-grid">
              <label className="full">Product name
                <input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g., Base Cabinet — 1 Door 1 Drawer" />
              </label>
              <label>Category
                <input list="product-cats" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="Cabinets" />
                <datalist id="product-cats">
                  {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label>Priced per
                <select value={form.unit} onChange={(e) => set('unit', e.target.value)}>
                  <option value="LF">LF — linear foot</option>
                  <option value="SF">SF — square foot</option>
                  <option value="EA">EA — each</option>
                </select>
              </label>
              <label className="full">Description
                <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What is this assembly? Construction notes, finish assumptions…" />
              </label>
            </div>
          </div>

          {/* ---- material components ---- */}
          <div className="panel">
            <h2 style={{ marginBottom: 4 }}>Materials <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>per 1 {form.unit}</span></h2>

            <div style={{ position: 'relative', marginBottom: 10 }}>
              <input
                type="search"
                value={matQ}
                onChange={(e) => setMatQ(e.target.value)}
                placeholder="Search the material library to add a component…"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, font: 'inherit', fontSize: 13.5 }}
              />
              {(matResults.length > 0 || searching) && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                  background: 'var(--surface)', border: '1px solid var(--border-strong)',
                  borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto',
                }}>
                  {searching && <div style={{ padding: 10, fontSize: 13 }} className="muted">Searching…</div>}
                  {matResults.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => addMaterial(m)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                        background: 'none', border: 0, borderBottom: '1px solid var(--border)',
                        cursor: 'pointer', font: 'inherit', fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{m.description || m.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {[m.manufacturer, m.category].filter(Boolean).join(' · ')} — ${Number(m.unit_cost).toFixed(2)}/{m.unit}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {mats.length === 0 ? (
              <div className="empty">No materials yet — search above to add plywood, laminate, hardware, edgebanding…</div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th style={{ width: 110 }} className="right">Qty / {form.unit}</th>
                      <th style={{ width: 60 }}>UoM</th>
                      <th style={{ width: 90 }} className="right">Waste %</th>
                      <th style={{ width: 100 }} className="right">Cost</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {mats.map((pm) => {
                      const waste = Number(pm.waste_pct || 0) > 0 ? Number(pm.waste_pct) : Number(pm.material?.waste_pct || 0);
                      const ext = Number(pm.qty_per_unit || 0) * Number(pm.material?.unit_cost || 0) * (1 + waste / 100);
                      return (
                        <tr key={pm.id}>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{pm.material?.description || pm.material?.name}</div>
                            <div className="muted" style={{ fontSize: 11.5 }}>
                              {[pm.material?.manufacturer, pm.material?.category].filter(Boolean).join(' · ')}
                              {' — $'}{Number(pm.material?.unit_cost || 0).toFixed(2)}/{pm.material?.unit}
                            </div>
                          </td>
                          <td><input type="number" step="0.0001" value={pm.qty_per_unit} onChange={(e) => patchMat(pm.id, 'qty_per_unit', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                          <td className="muted">{pm.material?.unit}</td>
                          <td><input type="number" step="0.1" value={pm.waste_pct} onChange={(e) => patchMat(pm.id, 'waste_pct', e.target.value)} style={{ width: '100%', textAlign: 'right' }} placeholder={String(pm.material?.waste_pct ?? 0)} /></td>
                          <td className="right money">{ext.toFixed(2)}</td>
                          <td className="right"><button className="btn sm ghost" onClick={() => dropMat(pm.id)}>×</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---- labor components ---- */}
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Labor <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>hours per 1 {form.unit}</span></h2>
              <button type="button" className="btn sm" onClick={addLaborRow}>+ Add trade</button>
            </div>

            {labor.length === 0 ? (
              <div className="empty">No labor yet — add hours for Machining, Assembly, Finishing, Install…</div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Trade</th>
                      <th style={{ width: 120 }} className="right">Hours / {form.unit}</th>
                      <th style={{ width: 100 }} className="right">Rate</th>
                      <th style={{ width: 100 }} className="right">Cost</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {labor.map((pl) => (
                      <tr key={pl.id}>
                        <td>
                          <select
                            value={pl.rate?.id || ''}
                            onChange={(e) => {
                              const r = rates.find((x) => x.id === e.target.value);
                              if (r) patchLabor(pl.id, 'rate', r);
                            }}
                            style={{ width: '100%' }}
                          >
                            {rates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </td>
                        <td><input type="number" step="0.01" value={pl.hours_per_unit} onChange={(e) => patchLabor(pl.id, 'hours_per_unit', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                        <td className="right money">{Number(pl.rate?.hourly_rate || 0).toFixed(2)}</td>
                        <td className="right money">{(Number(pl.hours_per_unit || 0) * Number(pl.rate?.hourly_rate || 0)).toFixed(2)}</td>
                        <td className="right"><button className="btn sm ghost" onClick={() => dropLabor(pl.id)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ---- live rollup rail ---- */}
        <div className="panel" style={{ position: 'sticky', top: 76 }}>
          <h3 style={{ marginBottom: 12 }}>Cost per {form.unit}</h3>
          <div className="stack" style={{ gap: 8, fontSize: 13.5 }}>
            <div className="row"><span className="muted flex-1">Materials</span><span className="money">{rollup.material.toFixed(2)}</span></div>
            <div className="row"><span className="muted flex-1">Labor</span><span className="money">{rollup.labor.toFixed(2)}</span></div>
            <div className="row" style={{ fontWeight: 700, fontSize: 17, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <span className="flex-1">Total</span><span className="money">{rollup.total.toFixed(2)}</span>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 12 }}>
            Estimates snapshot this cost when you drop the product in. Editing the product later
            doesn't change existing estimates.
          </p>
        </div>
      </div>
    </>
  );
}
