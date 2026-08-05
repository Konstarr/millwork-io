/**
 * Roll a product's components up into a per-unit cost.
 *
 * Expects a product row fetched with nested relations:
 *   product_materials ( qty_per_unit, waste_pct, material:material_id ( unit_cost, waste_pct ) )
 *   product_labor     ( hours_per_unit, rate:labor_rate_id ( hourly_rate ) )
 *
 * Component waste_pct, when > 0, overrides the material library's waste.
 */
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
