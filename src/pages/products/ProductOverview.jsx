import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import { computeProductCost } from '../../lib/productCost.js';

/**
 * Product drilldown, level 1: the overview.
 *
 * Read-only breakdown of what makes up this product's price — cost per
 * base unit split material vs labor, every component slot with its
 * material and extended cost, every labor operation with hours and cost.
 * "Edit parameters" goes one level deeper into the full builder.
 */
export default function ProductOverview() {
  const { id } = useParams();
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (id === 'new') return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name, category, unit, description, notes,
          default_width_ft, default_height_ft, default_depth_ft,
          product_materials ( id, slot, qty_per_unit, qty_formula, waste_pct, sort_order,
            material:material_id ( id, description, name, manufacturer, category, unit, unit_cost, waste_pct ) ),
          product_labor ( id, op, hours_per_unit, hours_formula, sort_order,
            rate:labor_rate_id ( id, name, hourly_rate ) )
        `)
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (error) setErr(error.message);
      setP(data || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const cost = useMemo(() => computeProductCost(p || {}), [p]);

  if (id === 'new') return <Navigate to="/products/new/edit" replace />;
  if (loading) return <div className="muted">Loading…</div>;
  if (!p) return (
    <div className="empty">
      Product not found. <Link to="/products">← All products</Link>
      {err && <div className="auth-err" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );

  const comps = (p.product_materials || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const ops   = (p.product_labor || []).slice().sort((a, b) => a.sort_order - b.sort_order);

  const compCost = (pm) => {
    const waste = Number(pm.waste_pct || 0) > 0 ? Number(pm.waste_pct) : Number(pm.material?.waste_pct || 0);
    return Number(pm.qty_per_unit || 0) * Number(pm.material?.unit_cost || 0) * (1 + waste / 100);
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>{p.name}</h1>
          <p>
            <Link to="/products">← All products</Link>
            {p.category ? <> · {p.category}</> : null}
            {' · priced per '}{p.unit}
          </p>
        </div>
        <div className="page-head-actions">
          <Link to={`/products/${p.id}/edit`} className="btn primary">Edit parameters →</Link>
        </div>
      </div>

      {p.description && <p className="muted" style={{ marginTop: -6, marginBottom: 16 }}>{p.description}</p>}

      {/* cost summary */}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 20 }}>
        <SummaryTile label={`Materials / ${p.unit}`} value={cost.material} money />
        <SummaryTile label={`Labor / ${p.unit}`}     value={cost.labor} money />
        <SummaryTile label={`Total cost / ${p.unit}`} value={cost.total} money strong />
        <SummaryTile
          label="Default size"
          text={`${Number(p.default_width_ft)}′W × ${Number(p.default_height_ft)}′H × ${Number(p.default_depth_ft)}′D`}
        />
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', alignItems: 'start' }}>
        {/* components */}
        <div className="panel">
          <h2 style={{ marginBottom: 10 }}>Components</h2>
          {comps.length === 0 ? (
            <div className="empty">No components configured yet.</div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Material</th>
                    <th className="right">Qty / {p.unit}</th>
                    <th className="right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {comps.map((pm) => (
                    <tr key={pm.id}>
                      <td style={{ fontWeight: 600 }}>
                        {pm.slot || '—'}
                        {pm.qty_formula && (
                          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                            = {pm.qty_formula}
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ fontSize: 13 }}>{pm.material?.description || pm.material?.name}</div>
                        <div className="muted" style={{ fontSize: 11.5 }}>
                          {[pm.material?.manufacturer, `$${Number(pm.material?.unit_cost || 0).toFixed(2)}/${pm.material?.unit}`].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="right muted">{Number(pm.qty_per_unit).toFixed(3)} {pm.material?.unit}</td>
                      <td className="right money">{compCost(pm).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} style={{ fontWeight: 700 }}>Materials total</td>
                    <td className="right money" style={{ fontWeight: 700 }}>{cost.material.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* labor operations */}
        <div className="panel">
          <h2 style={{ marginBottom: 10 }}>Labor operations</h2>
          {ops.length === 0 ? (
            <div className="empty">No labor hours configured yet.</div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Rate</th>
                    <th className="right">Hrs / {p.unit}</th>
                    <th className="right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map((pl) => (
                    <tr key={pl.id}>
                      <td style={{ fontWeight: 600 }}>
                        {pl.op || pl.rate?.name || '—'}
                        {pl.hours_formula && (
                          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                            = {pl.hours_formula} h/product
                          </div>
                        )}
                      </td>
                      <td className="muted">{pl.rate?.name} — ${Number(pl.rate?.hourly_rate || 0).toFixed(2)}/hr</td>
                      <td className="right muted">{Number(pl.hours_per_unit).toFixed(3)}</td>
                      <td className="right money">{(Number(pl.hours_per_unit || 0) * Number(pl.rate?.hourly_rate || 0)).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} style={{ fontWeight: 700 }}>Labor total</td>
                    <td className="right money" style={{ fontWeight: 700 }}>{cost.labor.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 6 }}>How this product measures</h3>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Recipe is defined per <b>1 {p.unit}</b>. In takeoff you can use any tool — conversions use the default size:
          counted each = {p.unit === 'EA' ? '1 EA' : p.unit === 'LF' ? `${Number(p.default_width_ft)} LF` : `${(Number(p.default_width_ft) * Number(p.default_height_ft)).toFixed(1)} SF`},
          measured LF and SF convert via {Number(p.default_width_ft)}′ width and {Number(p.default_height_ft)}′ height.
        </p>
      </div>
    </>
  );
}

function SummaryTile({ label, value, text, money, strong }) {
  return (
    <div className="panel">
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: strong ? 26 : 22, fontWeight: 700, marginTop: 4 }}>
        {text ?? (money ? `$${Number(value).toFixed(2)}` : value)}
      </div>
    </div>
  );
}
