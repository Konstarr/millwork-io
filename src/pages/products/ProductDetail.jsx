import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import { SLOT_SUGGESTIONS, LABOR_OPS, defaultRateForOp } from '../../lib/productCost.js';

/**
 * Product builder — drilldown level 2: the full parameter editor.
 *
 * A product is a spec, not a grab bag:
 *   COMPONENTS — named slots (Case Sides, Doors, Drawer Boxes, Hinges,
 *     Pulls, Edgebanding, Interior Finish, …). Each slot picks a material
 *     from the library and sets qty per base unit + waste. Changing the
 *     material in a slot is how "upgrade to Blum soft-close" changes price.
 *   LABOR OPERATIONS — the universal op list every product shares (Saw,
 *     CNC, Edgebanding, Assembly, Finishing, Install, …). Hours per base
 *     unit against your shop rates.
 *
 * The recipe is per 1 BASE UNIT (LF / SF / EA). Default width/height let
 * takeoff convert counts, linear runs, and areas into base units, so ONE
 * product can be measured any way.
 */

const CATEGORY_SUGGESTIONS = ['Cabinets', 'Die Walls', 'Paneling', 'Trim', 'Countertops', 'Closets', 'Doors', 'Specialty'];

export default function ProductDetail() {
  const { id } = useParams();
  const isNew  = !id || id === 'new';
  const nav    = useNavigate();

  const [form, setForm] = useState({
    name: '', category: '', unit: 'LF', description: '', notes: '',
    default_width_ft: 3, default_height_ft: 3, default_depth_ft: 2,
  });
  const [comps, setComps]   = useState([]);  // { id, slot, qty_per_unit, waste_pct, material }
  const [labor, setLabor]   = useState([]);  // { id, op, hours_per_unit, rate }
  const [rates, setRates]   = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving]   = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // Material search — one active picker at a time, keyed by comp row id.
  const [pickFor, setPickFor]     = useState(null);
  const [matQ, setMatQ]           = useState('');
  const [matResults, setMatResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lr = await supabase.from('labor_rates').select('id, name, hourly_rate').order('name');
      if (cancelled) return;
      const rateList = lr.data || [];
      setRates(rateList);

      if (isNew) {
        // Seed the universal op list so the estimator fills in hours, not rows.
        setLabor(LABOR_OPS.map((op, i) => ({
          id: `new_${i}`, op, hours_per_unit: 0, rate: defaultRateForOp(op, rateList),
        })));
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name, category, unit, description, notes,
          default_width_ft, default_height_ft, default_depth_ft,
          product_materials ( id, slot, qty_per_unit, waste_pct, sort_order,
            material:material_id ( id, name, description, manufacturer, category, unit, unit_cost, waste_pct ) ),
          product_labor ( id, op, hours_per_unit, sort_order,
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
          default_width_ft: Number(data.default_width_ft) || 3,
          default_height_ft: Number(data.default_height_ft) || 3,
          default_depth_ft: Number(data.default_depth_ft) || 2,
        });
        setComps((data.product_materials || []).sort((a, b) => a.sort_order - b.sort_order));

        // Merge saved ops onto the universal list; keep custom ops too.
        const saved = (data.product_labor || []).sort((a, b) => a.sort_order - b.sort_order);
        const merged = LABOR_OPS.map((op, i) => {
          const hit = saved.find((s) => (s.op || s.rate?.name) === op);
          return hit
            ? { id: hit.id, op, hours_per_unit: Number(hit.hours_per_unit), rate: hit.rate }
            : { id: `op_${i}`, op, hours_per_unit: 0, rate: defaultRateForOp(op, rateList) };
        });
        for (const s of saved) {
          if (!merged.some((m) => m.id === s.id)) {
            merged.push({ id: s.id, op: s.op || s.rate?.name || 'Custom', hours_per_unit: Number(s.hours_per_unit), rate: s.rate });
          }
        }
        setLabor(merged);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, isNew]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // ---- material search for the active slot picker ----
  useEffect(() => {
    const term = matQ.trim();
    if (term.length < 2 || !pickFor) { setMatResults([]); return; }
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
  }, [matQ, pickFor]);

  const addComp = (slot = '') => {
    const row = { id: `new_${crypto.randomUUID()}`, slot, qty_per_unit: 1, waste_pct: 0, material: null };
    setComps((cs) => [...cs, row]);
    setPickFor(row.id); setMatQ(''); setMatResults([]);
  };
  const patchComp = (rid, k, v) => setComps((cs) => cs.map((r) => r.id === rid ? { ...r, [k]: v } : r));
  const dropComp  = (rid) => { setComps((cs) => cs.filter((r) => r.id !== rid)); if (pickFor === rid) setPickFor(null); };
  const assignMaterial = (rid, m) => {
    patchComp(rid, 'material', m);
    setPickFor(null); setMatQ(''); setMatResults([]);
  };

  const patchLabor = (rid, k, v) => setLabor((ls) => ls.map((r) => r.id === rid ? { ...r, [k]: v } : r));
  const addCustomOp = () => {
    const name = prompt('Operation name:');
    if (!name?.trim()) return;
    setLabor((ls) => [...ls, {
      id: `new_${crypto.randomUUID()}`, op: name.trim(), hours_per_unit: 0,
      rate: defaultRateForOp(name, rates),
    }]);
  };

  // ---- live rollup ----
  const rollup = useMemo(() => {
    const material = comps.reduce((s, pm) => {
      if (!pm.material) return s;
      const waste = Number(pm.waste_pct || 0) > 0 ? Number(pm.waste_pct) : Number(pm.material?.waste_pct || 0);
      return s + Number(pm.qty_per_unit || 0) * Number(pm.material?.unit_cost || 0) * (1 + waste / 100);
    }, 0);
    const laborCost = labor.reduce((s, pl) =>
      s + Number(pl.hours_per_unit || 0) * Number(pl.rate?.hourly_rate || 0), 0);
    return { material, labor: laborCost, total: material + laborCost };
  }, [comps, labor]);

  const save = async (e) => {
    e?.preventDefault();
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    if (comps.some((c) => !c.material)) { setErr('Every component needs a material — remove empty rows or pick one.'); return; }
    setSaving(true); setErr(''); setMsg('');

    const header = {
      ...form,
      default_width_ft: Number(form.default_width_ft) || 3,
      default_height_ft: Number(form.default_height_ft) || 3,
      default_depth_ft: Number(form.default_depth_ft) || 2,
    };

    let productId = id;
    if (isNew) {
      const { data, error } = await supabase.from('products').insert(header).select('id').single();
      if (error) { setSaving(false); setErr(error.message); return; }
      productId = data.id;
    } else {
      const { error } = await supabase.from('products').update(header).eq('id', id);
      if (error) { setSaving(false); setErr(error.message); return; }
    }

    await supabase.from('product_materials').delete().eq('product_id', productId);
    await supabase.from('product_labor').delete().eq('product_id', productId);

    if (comps.length) {
      const { error } = await supabase.from('product_materials').insert(
        comps.map((pm, i) => ({
          product_id: productId,
          material_id: pm.material.id,
          slot: pm.slot || null,
          qty_per_unit: Number(pm.qty_per_unit || 0),
          waste_pct: Number(pm.waste_pct || 0),
          sort_order: i,
        }))
      );
      if (error) { setSaving(false); setErr(error.message); return; }
    }
    const laborToSave = labor.filter((pl) => Number(pl.hours_per_unit) > 0 && pl.rate);
    if (laborToSave.length) {
      const { error } = await supabase.from('product_labor').insert(
        laborToSave.map((pl, i) => ({
          product_id: productId,
          labor_rate_id: pl.rate.id,
          op: pl.op,
          hours_per_unit: Number(pl.hours_per_unit || 0),
          sort_order: i,
        }))
      );
      if (error) { setSaving(false); setErr(error.message); return; }
    }

    setSaving(false);
    nav(`/products/${productId}`, { replace: true });
  };

  const remove = async () => {
    if (!confirm('Delete this product? Estimates that used it keep their snapshot lines.')) return;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    nav('/products', { replace: true });
  };

  if (loading) return <div className="muted">Loading…</div>;

  const unusedSlots = SLOT_SUGGESTIONS.filter((s) => !comps.some((c) => c.slot === s));

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>{isNew ? 'New product' : `${form.name || 'Product'} — parameters`}</h1>
          <p>
            {isNew
              ? <Link to="/products">← All products</Link>
              : <Link to={`/products/${id}`}>← Back to overview</Link>}
          </p>
        </div>
        <div className="page-head-actions">
          {!isNew && <button className="btn ghost" onClick={remove}>Delete</button>}
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : (isNew ? 'Create product' : 'Save parameters')}
          </button>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="auth-note" style={{ marginBottom: 10 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 250px', gap: 16, alignItems: 'start' }}>
        <div className="stack">
          {/* ---- basics ---- */}
          <div className="panel">
            <h2 style={{ marginBottom: 10 }}>Basics</h2>
            <div className="form-grid">
              <label className="full">Product name
                <input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g., Base Cabinet — Door/Drawer" />
              </label>
              <label>Category
                <input list="product-cats" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="Cabinets" />
                <datalist id="product-cats">
                  {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label>Recipe base unit
                <select value={form.unit} onChange={(e) => set('unit', e.target.value)}>
                  <option value="LF">per LF — cabinets, runs, trim</option>
                  <option value="SF">per SF — paneling, surfaces</option>
                  <option value="EA">per EA — one-off items</option>
                </select>
              </label>
              <label>Default width (ft)
                <input type="number" step="0.25" value={form.default_width_ft} onChange={(e) => set('default_width_ft', e.target.value)} />
              </label>
              <label>Default height (ft)
                <input type="number" step="0.25" value={form.default_height_ft} onChange={(e) => set('default_height_ft', e.target.value)} />
              </label>
              <label>Default depth (ft)
                <input type="number" step="0.25" value={form.default_depth_ft} onChange={(e) => set('default_depth_ft', e.target.value)} />
              </label>
              <label className="full">Description
                <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Construction notes, finish assumptions…" />
              </label>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              Components and labor below are <b>per 1 {form.unit}</b>. Default size converts other
              takeoff measurements (count / LF / SF) into {form.unit}.
            </p>
          </div>

          {/* ---- component slots ---- */}
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={{ margin: 0 }}>Components</h2>
              <button type="button" className="btn sm" onClick={() => addComp('')}>+ Custom component</button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '2px 0 10px' }}>
              Each component is a setting: pick the material that fills it. Swap the material to change the spec (and the price).
            </p>

            {/* quick-add chips for standard slots */}
            {unusedSlots.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {unusedSlots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="btn sm ghost"
                    style={{ fontSize: 11.5, padding: '3px 9px' }}
                    onClick={() => addComp(s)}
                  >
                    + {s}
                  </button>
                ))}
              </div>
            )}

            {comps.length === 0 ? (
              <div className="empty">No components yet — click a slot above (Case Sides, Doors, Hinges…) to start the spec.</div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {comps.map((pm) => {
                  const waste = Number(pm.waste_pct || 0) > 0 ? Number(pm.waste_pct) : Number(pm.material?.waste_pct || 0);
                  const ext = pm.material ? Number(pm.qty_per_unit || 0) * Number(pm.material.unit_cost || 0) * (1 + waste / 100) : 0;
                  return (
                    <div key={pm.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--surface-alt)' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          list="slot-suggestions"
                          value={pm.slot || ''}
                          onChange={(e) => patchComp(pm.id, 'slot', e.target.value)}
                          placeholder="Component name"
                          style={{ width: 170, fontWeight: 600, padding: '6px 8px', border: '1px solid var(--border-strong)', borderRadius: 6, font: 'inherit', fontSize: 13 }}
                        />
                        <div style={{ flex: '1 1 240px', minWidth: 200 }}>
                          {pm.material ? (
                            <button
                              type="button"
                              onClick={() => { setPickFor(pm.id); setMatQ(''); }}
                              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', width: '100%' }}
                              title="Click to change material"
                            >
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>
                                {pm.material.description || pm.material.name} ✎
                              </div>
                              <div className="muted" style={{ fontSize: 11.5 }}>
                                {[pm.material.manufacturer, `$${Number(pm.material.unit_cost).toFixed(2)}/${pm.material.unit}`].filter(Boolean).join(' · ')}
                              </div>
                            </button>
                          ) : (
                            <button type="button" className="btn sm ghost" onClick={() => { setPickFor(pm.id); setMatQ(''); }}>
                              Pick material…
                            </button>
                          )}
                        </div>
                        <label style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'grid', gap: 2 }}>
                          Qty / {form.unit}
                          <input type="number" step="0.0001" value={pm.qty_per_unit} onChange={(e) => patchComp(pm.id, 'qty_per_unit', e.target.value)} style={{ width: 90, textAlign: 'right' }} />
                        </label>
                        <label style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'grid', gap: 2 }}>
                          Waste %
                          <input type="number" step="0.1" value={pm.waste_pct} onChange={(e) => patchComp(pm.id, 'waste_pct', e.target.value)} style={{ width: 70, textAlign: 'right' }} placeholder={String(pm.material?.waste_pct ?? 0)} />
                        </label>
                        <div style={{ width: 80, textAlign: 'right', fontWeight: 700 }} className="money">{ext.toFixed(2)}</div>
                        <button type="button" className="btn sm ghost" onClick={() => dropComp(pm.id)}>×</button>
                      </div>

                      {/* inline material search for this slot */}
                      {pickFor === pm.id && (
                        <div style={{ marginTop: 8, position: 'relative' }}>
                          <input
                            autoFocus
                            type="search"
                            value={matQ}
                            onChange={(e) => setMatQ(e.target.value)}
                            placeholder={`Search the library for ${pm.slot || 'this component'}…`}
                            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--primary)', borderRadius: 6, font: 'inherit', fontSize: 13.5 }}
                          />
                          {(matResults.length > 0 || searching) && (
                            <div style={{
                              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                              background: 'var(--surface)', border: '1px solid var(--border-strong)',
                              borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 260, overflowY: 'auto',
                            }}>
                              {searching && <div style={{ padding: 10, fontSize: 13 }} className="muted">Searching…</div>}
                              {matResults.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => assignMaterial(pm.id, m)}
                                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'none', border: 0, borderBottom: '1px solid var(--border)', cursor: 'pointer', font: 'inherit', fontSize: 13 }}
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
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <datalist id="slot-suggestions">
              {SLOT_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>

          {/* ---- universal labor operations ---- */}
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={{ margin: 0 }}>Labor operations <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>hours per 1 {form.unit}</span></h2>
              <button type="button" className="btn sm" onClick={addCustomOp}>+ Custom op</button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '2px 0 10px' }}>
              The same operations apply to every product — set the hours that apply, leave the rest at 0.
            </p>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th style={{ width: 220 }}>Rate</th>
                    <th style={{ width: 110 }} className="right">Hrs / {form.unit}</th>
                    <th style={{ width: 90 }} className="right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {labor.map((pl) => (
                    <tr key={pl.id} style={{ opacity: Number(pl.hours_per_unit) > 0 ? 1 : 0.65 }}>
                      <td style={{ fontWeight: 600 }}>{pl.op}</td>
                      <td>
                        <select
                          value={pl.rate?.id || ''}
                          onChange={(e) => {
                            const r = rates.find((x) => x.id === e.target.value);
                            if (r) patchLabor(pl.id, 'rate', r);
                          }}
                          style={{ width: '100%' }}
                        >
                          {rates.length === 0 && <option value="">— add rates on the Labor page —</option>}
                          {rates.map((r) => <option key={r.id} value={r.id}>{r.name} (${Number(r.hourly_rate).toFixed(2)}/hr)</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="number" step="0.01" min="0" value={pl.hours_per_unit}
                          onChange={(e) => patchLabor(pl.id, 'hours_per_unit', e.target.value)}
                          style={{ width: '100%', textAlign: 'right' }} />
                      </td>
                      <td className="right money">{(Number(pl.hours_per_unit || 0) * Number(pl.rate?.hourly_rate || 0)).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            Estimates snapshot this cost when the product is placed. Editing here
            doesn't change existing estimates.
          </p>
        </div>
      </div>
    </>
  );
}
