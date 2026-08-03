import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
/**
 * Estimate editor.
 *
 * An estimate = header (project, name, status, markup %, tax %) + N lines.
 * Each line is either:
 *   - kind='material' → pulls unit_cost from materials library (or overridden)
 *   - kind='labor'    → pulls hourly_rate from labor_rates (or overridden)
 *   - kind='other'    → freeform (subs, freight, misc)
 *
 * Totals are computed client-side on save so the estimator sees them live;
 * a server-side trigger recomputes total_amount as the source of truth.
 */
const STATUSES = ['draft', 'sent', 'accepted', 'rejected'];

const emptyLine = () => ({
  id: crypto.randomUUID(),
  _new: true,
  kind: 'material',
  description: '',
  material_id: null,
  labor_rate_id: null,
  quantity: 1,
  unit: 'ea',
  unit_cost: 0,
  waste_pct: 0,
  sort_order: 0,
});

export default function EstimateDetail() {
  const { id }         = useParams();
  const isNew          = id === 'new';
  const nav            = useNavigate();
  const [params]       = useSearchParams();

  const [header, setHeader] = useState({
    name: '',
    project_id: params.get('project') || '',
    status: 'draft',
    markup_pct: 15,
    tax_pct: 0,
    notes: '',
  });
  const [lines, setLines]           = useState([]);
  const [projects, setProjects]     = useState([]);
  const [materials, setMaterials]   = useState([]);
  const [laborRates, setLaborRates] = useState([]);
  const [loading, setLoading]       = useState(!isNew);
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState('');
  const [msg, setMsg]               = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pr, mt, lr] = await Promise.all([
        supabase.from('projects').select('id, name, customer:customer_id(name)').order('name'),
        supabase.from('materials').select('id, sku, name, unit, unit_cost, waste_pct').order('name'),
        supabase.from('labor_rates').select('id, name, hourly_rate').order('name'),
      ]);
      if (cancelled) return;
      setProjects(pr.data || []);
      setMaterials(mt.data || []);
      setLaborRates(lr.data || []);

      if (isNew) { setLoading(false); return; }
      const [est, ls] = await Promise.all([
        supabase.from('estimates').select('*').eq('id', id).maybeSingle(),
        supabase.from('estimate_lines').select('*').eq('estimate_id', id).order('sort_order', { ascending: true }),
      ]);
      if (cancelled) return;
      if (est.error) setErr(est.error.message);
      setHeader({ ...header, ...(est.data || {}) });
      setLines(ls.data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  const setH = (k, v) => setHeader((h) => ({ ...h, [k]: v }));

  const addLine = (kind = 'material') => {
    setLines((ls) => [...ls, { ...emptyLine(), kind, sort_order: ls.length }]);
  };
  const removeLine = (lineId) => setLines((ls) => ls.filter((l) => l.id !== lineId));
  const patchLine  = (lineId, patch) => setLines((ls) => ls.map((l) => l.id === lineId ? { ...l, ...patch } : l));

  // When admin picks a material, autofill description/unit/cost/waste.
  const onPickMaterial = (lineId, materialId) => {
    const m = materials.find((x) => x.id === materialId);
    if (!m) { patchLine(lineId, { material_id: null }); return; }
    patchLine(lineId, {
      material_id: m.id,
      description: m.name + (m.sku ? ` (${m.sku})` : ''),
      unit: m.unit || 'ea',
      unit_cost: Number(m.unit_cost || 0),
      waste_pct: Number(m.waste_pct || 0),
    });
  };
  const onPickLabor = (lineId, rateId) => {
    const r = laborRates.find((x) => x.id === rateId);
    if (!r) { patchLine(lineId, { labor_rate_id: null }); return; }
    patchLine(lineId, {
      labor_rate_id: r.id,
      description: r.name,
      unit: 'hr',
      unit_cost: Number(r.hourly_rate || 0),
      waste_pct: 0,
    });
  };

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, l) => {
      const qty  = Number(l.quantity || 0);
      const cost = Number(l.unit_cost || 0);
      const waste = Number(l.waste_pct || 0) / 100;
      return sum + qty * cost * (1 + waste);
    }, 0);
    const markup = subtotal * (Number(header.markup_pct || 0) / 100);
    const preTax = subtotal + markup;
    const tax    = preTax * (Number(header.tax_pct || 0) / 100);
    return { subtotal, markup, tax, total: preTax + tax };
  }, [lines, header.markup_pct, header.tax_pct]);

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true); setErr(''); setMsg('');

    // 1. upsert header
    const headerPayload = {
      ...header,
      project_id: header.project_id || null,
      total_amount: totals.total,
    };
    let estimateId = id;
    if (isNew) {
      const { data, error } = await supabase.from('estimates').insert(headerPayload).select('id').single();
      if (error) { setSaving(false); setErr(error.message); return; }
      estimateId = data.id;
    } else {
      const { error } = await supabase.from('estimates').update(headerPayload).eq('id', id);
      if (error) { setSaving(false); setErr(error.message); return; }
    }

    // 2. wipe + reinsert lines (simple + safe for a small line count)
    await supabase.from('estimate_lines').delete().eq('estimate_id', estimateId);
    if (lines.length > 0) {
      const payload = lines.map((l, i) => ({
        estimate_id: estimateId,
        kind: l.kind,
        description: l.description || '',
        material_id: l.material_id || null,
        labor_rate_id: l.labor_rate_id || null,
        quantity: Number(l.quantity || 0),
        unit: l.unit || 'ea',
        unit_cost: Number(l.unit_cost || 0),
        waste_pct: Number(l.waste_pct || 0),
        sort_order: i,
      }));
      const { error } = await supabase.from('estimate_lines').insert(payload);
      if (error) { setSaving(false); setErr(error.message); return; }
    }

    setSaving(false);
    if (isNew) nav(`/estimates/${estimateId}`, { replace: true });
    else setMsg('Saved.');
  };

  const remove = async () => {
    if (!confirm('Delete this estimate and all its lines?')) return;
    const { error } = await supabase.from('estimates').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    nav('/estimates', { replace: true });
  };

  if (loading) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>{isNew ? 'New estimate' : (header.name || 'Estimate')}</h1>
          <p><Link to="/estimates">← All estimates</Link></p>
        </div>
        <div className="page-head-actions">
          {!isNew && <button className="btn ghost" onClick={remove}>Delete</button>}
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : (isNew ? 'Create estimate' : 'Save estimate')}
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="form-grid">
          <label>Name
            <input value={header.name} onChange={(e) => setH('name', e.target.value)} placeholder="Base bid — Rev A" />
          </label>
          <label>Project
            <select value={header.project_id || ''} onChange={(e) => setH('project_id', e.target.value)}>
              <option value="">— none —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.customer?.name ? ` — ${p.customer.name}` : ''}</option>
              ))}
            </select>
          </label>
          <label>Status
            <select value={header.status} onChange={(e) => setH('status', e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Markup %
            <input type="number" step="0.1" value={header.markup_pct} onChange={(e) => setH('markup_pct', e.target.value)} />
          </label>
          <label>Tax %
            <input type="number" step="0.001" value={header.tax_pct} onChange={(e) => setH('tax_pct', e.target.value)} />
          </label>
          <label className="full">Notes
            <textarea rows={2} value={header.notes || ''} onChange={(e) => setH('notes', e.target.value)} />
          </label>
        </div>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Line items</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn sm" onClick={() => addLine('material')}>+ Material</button>
            <button type="button" className="btn sm" onClick={() => addLine('labor')}>+ Labor</button>
            <button type="button" className="btn sm" onClick={() => addLine('other')}>+ Other</button>
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="empty">No line items yet. Add material, labor, or other above.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Kind</th>
                  <th>Item</th>
                  <th style={{ width: 90 }} className="right">Qty</th>
                  <th style={{ width: 70 }}>Unit</th>
                  <th style={{ width: 110 }} className="right">Unit cost</th>
                  <th style={{ width: 90 }} className="right">Waste %</th>
                  <th style={{ width: 120 }} className="right">Extended</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const extended = Number(l.quantity || 0) * Number(l.unit_cost || 0) * (1 + Number(l.waste_pct || 0) / 100);
                  return (
                    <tr key={l.id}>
                      <td>
                        <select value={l.kind} onChange={(e) => patchLine(l.id, { kind: e.target.value, material_id: null, labor_rate_id: null })} style={{ width: '100%' }}>
                          <option value="material">Material</option>
                          <option value="labor">Labor</option>
                          <option value="other">Other</option>
                        </select>
                      </td>
                      <td>
                        {l.kind === 'material' ? (
                          <select value={l.material_id || ''} onChange={(e) => onPickMaterial(l.id, e.target.value)} style={{ width: '100%' }}>
                            <option value="">— custom —</option>
                            {materials.map((m) => <option key={m.id} value={m.id}>{m.name}{m.sku ? ` (${m.sku})` : ''}</option>)}
                          </select>
                        ) : l.kind === 'labor' ? (
                          <select value={l.labor_rate_id || ''} onChange={(e) => onPickLabor(l.id, e.target.value)} style={{ width: '100%' }}>
                            <option value="">— custom —</option>
                            {laborRates.map((r) => <option key={r.id} value={r.id}>{r.name} (${Number(r.hourly_rate).toFixed(2)}/hr)</option>)}
                          </select>
                        ) : null}
                        <input
                          value={l.description}
                          onChange={(e) => patchLine(l.id, { description: e.target.value })}
                          placeholder={l.kind === 'other' ? 'Description' : 'Optional override description'}
                          style={{ width: '100%', marginTop: 4 }}
                        />
                      </td>
                      <td><input type="number" step="0.001" value={l.quantity} onChange={(e) => patchLine(l.id, { quantity: e.target.value })} style={{ width: '100%', textAlign: 'right' }} /></td>
                      <td><input value={l.unit || ''} onChange={(e) => patchLine(l.id, { unit: e.target.value })} style={{ width: '100%' }} /></td>
                      <td><input type="number" step="0.01" value={l.unit_cost} onChange={(e) => patchLine(l.id, { unit_cost: e.target.value })} style={{ width: '100%', textAlign: 'right' }} /></td>
                      <td><input type="number" step="0.1" value={l.waste_pct} onChange={(e) => patchLine(l.id, { waste_pct: e.target.value })} style={{ width: '100%', textAlign: 'right' }} /></td>
                      <td className="right money">{extended.toFixed(2)}</td>
                      <td className="right"><button type="button" className="btn sm ghost" onClick={() => removeLine(l.id)}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'grid', gap: 4, justifyContent: 'end', marginTop: 14, fontSize: 13 }}>
          <div className="row"><span className="muted flex-1">Subtotal</span><span className="money">{totals.subtotal.toFixed(2)}</span></div>
          <div className="row"><span className="muted flex-1">Markup ({header.markup_pct || 0}%)</span><span className="money">{totals.markup.toFixed(2)}</span></div>
          <div className="row"><span className="muted flex-1">Tax ({header.tax_pct || 0}%)</span><span className="money">{totals.tax.toFixed(2)}</span></div>
          <div className="row" style={{ fontWeight: 700, fontSize: 16, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
            <span className="flex-1">Total</span><span className="money">{totals.total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginTop: 12 }}>{err}</div>}
      {msg && <div className="auth-note" style={{ marginTop: 12 }}>{msg}</div>}
    </>
  );
}
