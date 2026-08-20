/**
 * Product cost + measurement conversion helpers.
 *
 * A product's recipe (component materials + labor operation hours) is
 * defined per ONE base unit (product.unit: 'LF' | 'SF' | 'EA'). Default
 * dimensions on the product convert any takeoff measurement into that
 * base, so a single product can be counted, run linear, or traced as an
 * area.
 */

/** Roll a product's components up into a per-base-unit cost. */
export function computeProductCost(product) {
  const material = (product?.product_materials || []).reduce((sum, pm) => {
    const qty   = Number(pm.qty_per_unit || 0);
    const cost  = Number(pm.material?.unit_cost || 0);
    const waste = Number(pm.waste_pct || 0) > 0
      ? Number(pm.waste_pct)
      : Number(pm.material?.waste_pct || 0);
    return sum + qty * cost * (1 + waste / 100);
  }, 0);

  const labor = (product?.product_labor || []).reduce((sum, pl) => {
    const hrs  = Number(pl.hours_per_unit || 0);
    const rate = Number(pl.rate?.hourly_rate || 0);
    return sum + hrs * rate;
  }, 0);

  return { material, labor, total: material + labor };
}

/**
 * Convert a measured takeoff quantity into the product's base unit.
 *   tool: 'count' (EA measured) | 'linear' (LF) | 'area' (SF)
 * Falls back to sensible defaults when dims are missing.
 */
export function convertToBase(product, tool, qty) {
  const base = product?.unit || 'LF';
  const w = Number(product?.default_width_ft)  || 3;
  const h = Number(product?.default_height_ft) || 3;
  const n = Number(qty || 0);

  if (tool === 'count') {          // measured in EA
    if (base === 'EA') return n;
    if (base === 'LF') return n * w;
    if (base === 'SF') return n * w * h;
  }
  if (tool === 'linear') {         // measured in LF
    if (base === 'LF') return n;
    if (base === 'EA') return w > 0 ? n / w : n;
    if (base === 'SF') return n * h;
  }
  if (tool === 'area') {           // measured in SF
    if (base === 'SF') return n;
    if (base === 'LF') return h > 0 ? n / h : n;
    if (base === 'EA') return (w * h) > 0 ? n / (w * h) : n;
  }
  return n;
}

/** Standard component slots — suggestions, not restrictions. */
export const SLOT_SUGGESTIONS = [
  'Case Sides', 'Case Top/Bottom', 'Case Back', 'Shelves', 'Toe Kick',
  'Stretchers', 'Doors', 'Drawer Fronts', 'Drawer Boxes', 'Drawer Slides',
  'Hinges', 'Pulls/Knobs', 'Edgebanding', 'Interior Finish',
  'Exterior Finish', 'Countertop', 'Panel Face', 'Substrate', 'Trim',
  'Misc Hardware',
];

/** Universal labor operations shown on every product. */
export const LABOR_OPS = [
  'Saw / Panel Cutting',
  'CNC',
  'Edgebanding',
  'Assembly',
  'Drawer / Door Fitting',
  'Finishing',
  'Shipping',
  'Install',
  'Project Mgmt',
  'Drafting / Engineering',
];

/** Best-effort default rate for an op, by fuzzy name match. */
export function defaultRateForOp(op, rates) {
  if (!rates?.length) return null;
  const needle = op.toLowerCase();
  const hit = rates.find((r) => {
    const n = (r.name || '').toLowerCase();
    return needle.split(/[\s/]+/).some((word) => word.length > 2 && n.includes(word));
  });
  return hit || rates[0];
}
