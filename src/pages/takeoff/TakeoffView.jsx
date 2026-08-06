import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from '../../lib/supabase.js';
import { computeProductCost } from '../../lib/productCost.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Takeoff view — place products directly on an architectural drawing.
 *
 * Pipeline:
 *   1. Open a drawing (PDF via pdf.js, or plain image).
 *   2. CALIBRATE: click two points of a known dimension, type the real feet.
 *      ft-per-unit is saved per page on project_files.scales.
 *   3. Pick a product + tool and draw:
 *        count  (EA) — every click drops a marker            → qty 1 each
 *        linear (LF) — click vertices, double-click/Enter    → true feet
 *        area   (SF) — click vertices, double-click closes   → true sqft
 *   4. Items autosave to takeoff_items in PDF-space coordinates.
 *   5. "Send to estimate" rolls quantities per product into a new draft
 *      estimate with snapshotted unit costs.
 *
 * Coordinates: all saved points are in page units at zoom 1 (PDF points, or
 * natural pixels for images). Screen px = unit * zoom.
 */

const TOOLS = [
  { id: 'select',    label: 'Select',    hint: 'Click a shape to select; Delete removes it' },
  { id: 'calibrate', label: 'Calibrate', hint: 'Click two points of a known dimension' },
  { id: 'count',     label: 'Count',     hint: 'Click to place each unit (EA products)' },
  { id: 'linear',    label: 'Linear',    hint: 'Click vertices; double-click or Enter to finish (LF products)' },
  { id: 'area',      label: 'Area',      hint: 'Click vertices; double-click to close (SF products)' },
  { id: 'wall',      label: 'Wall',      hint: 'Trace wall centerlines; double-click to finish. Powers the 3D view.' },
  { id: 'pickwall',  label: 'Wall pick', hint: 'Click directly on a wall line — it auto-traces its full length' },
  { id: 'region',    label: 'Plan area', hint: 'Click two corners to designate the floor plan for 3D' },
];

const TOOL_UNIT = { count: 'EA', linear: 'LF', area: 'SF' };

function colorFor(id) {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 75% 42%)`;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function polylineLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

function centroid(pts) {
  const n = pts.length || 1;
  return [
    pts.reduce((s, p) => s + p[0], 0) / n,
    pts.reduce((s, p) => s + p[1], 0) / n,
  ];
}

/**
 * Wall pick: given a click on the rendered drawing, find the dark line under
 * the cursor and walk it to both ends (axis-aligned, gap-tolerant so wall
 * tags and anti-aliasing don't stop the trace). Returns [[x1,y1],[x2,y2]]
 * in canvas pixels, or null if there's no traceable line at the click.
 */
function autoTraceWall(canvas, clickPx, clickPy) {
  const W = canvas.width, H = canvas.height;
  // Read a window (full canvas if small) so huge sheets don't blow memory.
  const MAX_AREA = 20e6;
  let ox = 0, oy = 0, w = W, h = H;
  if (W * H > MAX_AREA) {
    w = Math.min(W, 3600); h = Math.min(H, 3600);
    ox = Math.round(Math.min(Math.max(0, clickPx - w / 2), W - w));
    oy = Math.round(Math.min(Math.max(0, clickPy - h / 2), H - h));
  }
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(ox, oy, w, h).data;
  const dark = (x, y) => {
    x = Math.round(x) - ox; y = Math.round(y) - oy;
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = (y * w + x) * 4;
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < 150;
  };

  // Find a dark seed pixel near the click.
  let seed = null;
  outer:
  for (let r = 0; r <= 7; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (dark(clickPx + dx, clickPy + dy)) { seed = [clickPx + dx, clickPy + dy]; break outer; }
      }
    }
  }
  if (!seed) return null;

  const PERP = 4, GAP = 5, MAX_WALK = 20000;
  // "Still on the line" = any ink within ±PERP px perpendicular — tolerates
  // wall thickness and a couple degrees of skew.
  const darkBand = (x, y, horiz) => {
    for (let p = -PERP; p <= PERP; p++) {
      if (horiz ? dark(x, y + p) : dark(x + p, y)) return true;
    }
    return false;
  };
  const walk = (horiz, dir) => {
    let x = seed[0], y = seed[1], gap = 0, last = horiz ? x : y;
    for (let i = 0; i < MAX_WALK; i++) {
      if (horiz) x += dir; else y += dir;
      if (darkBand(x, y, horiz)) { gap = 0; last = horiz ? x : y; }
      else if (++gap > GAP) break;
    }
    return last;
  };
  const x1 = walk(true, -1),  x2 = walk(true, 1);
  const y1 = walk(false, -1), y2 = walk(false, 1);
  const hLen = x2 - x1, vLen = y2 - y1;
  if (Math.max(hLen, vLen) < 12) return null;

  // Center the segment within the line's thickness for a clean centerline.
  const center = (horiz) => {
    const base = horiz ? seed[1] : seed[0];
    let lo = base, hi = base;
    for (let p = 1; p <= 15; p++) {
      if (horiz ? dark(seed[0], base - p) : dark(base - p, seed[1])) lo = base - p; else break;
    }
    for (let p = 1; p <= 15; p++) {
      if (horiz ? dark(seed[0], base + p) : dark(base + p, seed[1])) hi = base + p; else break;
    }
    return (lo + hi) / 2;
  };

  if (hLen >= vLen) {
    const yc = center(true);
    return [[x1, yc], [x2, yc]];
  }
  const xc = center(false);
  return [[xc, y1], [xc, y2]];
}

// Min distance from point p to segment ab — for click-to-select hit tests.
function segDist(p, a, b) {
  const l2 = dist(a, b) ** 2;
  if (l2 === 0) return dist(p, a);
  let t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
}

export default function TakeoffView() {
  const { fileId } = useParams();
  const nav = useNavigate();

  const canvasRef  = useRef(null);
  const overlayRef = useRef(null);
  const imgRef     = useRef(null);   // image-mode source for wall picking
  const pdfRef     = useRef(null);   // pdf.js document
  const renderTask = useRef(null);

  const [file, setFile]         = useState(null);   // project_files row
  const [signedUrl, setSigned]  = useState(null);
  const [isImage, setIsImage]   = useState(false);
  const [numPages, setNumPages] = useState(1);
  const [page, setPage]         = useState(1);
  const [zoom, setZoom]         = useState(1);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 }); // in units (zoom 1)

  const [scales, setScales]     = useState({});     // { pageNumber: ftPerUnit }
  const [items, setItems]       = useState([]);
  const [products, setProducts] = useState([]);

  const [tool, setTool]           = useState('select');
  const [productId, setProductId] = useState('');
  const [draft, setDraft]         = useState([]);   // in-progress points (units)
  const [selected, setSelected]   = useState(null); // takeoff item id
  const [err, setErr]             = useState('');
  const [busy, setBusy]           = useState(false);
  const [loading, setLoading]     = useState(true);

  const ftPerUnit = Number(scales[page] || 0);

  // ---------- data load ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [f, pd] = await Promise.all([
        supabase.from('project_files').select('*').eq('id', fileId).maybeSingle(),
        supabase.from('products').select(`
          id, name, category, unit,
          product_materials ( qty_per_unit, waste_pct, material:material_id ( unit_cost, waste_pct ) ),
          product_labor     ( hours_per_unit, rate:labor_rate_id ( hourly_rate ) )
        `).order('name'),
      ]);
      if (cancelled) return;
      if (!f.data) { setErr('Drawing not found.'); setLoading(false); return; }
      setFile(f.data);
      setScales(f.data.scales || {});
      setProducts(pd.data || []);

      const it = await supabase.from('takeoff_items').select('*').eq('file_id', fileId).order('created_at');
      if (!cancelled) setItems(it.data || []);

      const su = await supabase.storage.from('drawings').createSignedUrl(f.data.storage_path, 3600 * 6);
      if (cancelled) return;
      if (su.error) { setErr(su.error.message); setLoading(false); return; }
      setSigned(su.data.signedUrl);
      setIsImage((f.data.mime_type || '').startsWith('image/'));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fileId]);

  // ---------- PDF / image rendering ----------
  const renderPage = useCallback(async () => {
    if (!signedUrl || isImage) return;
    try {
      if (!pdfRef.current) {
        pdfRef.current = await pdfjsLib.getDocument({ url: signedUrl }).promise;
        setNumPages(pdfRef.current.numPages);
      }
      const pdfPage = await pdfRef.current.getPage(page);
      const viewport = pdfPage.getViewport({ scale: zoom });
      const base     = pdfPage.getViewport({ scale: 1 });
      setPageSize({ w: base.width, h: base.height });

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      renderTask.current?.cancel?.();
      renderTask.current = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport });
      await renderTask.current.promise.catch(() => {});
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') setErr(`Could not render PDF: ${e.message || e}`);
    }
  }, [signedUrl, isImage, page, zoom]);

  useEffect(() => { renderPage(); }, [renderPage]);

  const onImgLoad = (e) => {
    setPageSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
  };

  // ---------- coordinate transforms ----------
  const toUnits = (evt) => {
    const rect = overlayRef.current.getBoundingClientRect();
    return [(evt.clientX - rect.left) / zoom, (evt.clientY - rect.top) / zoom];
  };

  // ---------- item persistence ----------
  const saveItem = async (toolKind, pts, qty) => {
    const { data, error } = await supabase.from('takeoff_items').insert({
      project_id: file.project_id,
      file_id: fileId,
      page,
      // Walls belong to no product — they define geometry for the 3D view.
      product_id: toolKind === 'wall' ? null : (productId || null),
      tool: toolKind,
      points: pts,
      qty,
    }).select('*').single();
    if (error) { setErr(error.message); return; }
    setItems((xs) => [...xs, data]);
  };

  const deleteItem = async (itemId) => {
    setItems((xs) => xs.filter((x) => x.id !== itemId));
    setSelected(null);
    await supabase.from('takeoff_items').delete().eq('id', itemId);
  };

  const saveScale = async (nextFtPerUnit) => {
    const next = { ...scales, [page]: nextFtPerUnit };
    setScales(next);
    await supabase.from('project_files').update({ scales: next }).eq('id', fileId);
  };

  // ---------- drawing interactions ----------
  const finishDraft = useCallback(async () => {
    if (tool === 'linear' && draft.length >= 2) {
      const qty = polylineLen(draft) * ftPerUnit;
      await saveItem('linear', draft, qty);
    } else if (tool === 'area' && draft.length >= 3) {
      const qty = polygonArea(draft) * ftPerUnit * ftPerUnit;
      await saveItem('area', draft, qty);
    } else if (tool === 'wall' && draft.length >= 2) {
      const qty = polylineLen(draft) * ftPerUnit;
      await saveItem('wall', draft, qty);
    }
    setDraft([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, draft, ftPerUnit, productId, page]);

  const onOverlayClick = async (evt) => {
    const pt = toUnits(evt);

    if (tool === 'calibrate') {
      if (draft.length === 0) { setDraft([pt]); return; }
      const p0 = draft[0];
      setDraft([]);
      const px = dist(p0, pt);
      if (px < 2) return;
      const real = prompt('Real-world length of the line you just drew (feet):', '10');
      const ft = Number(real);
      if (!ft || ft <= 0) return;
      await saveScale(ft / px);
      return;
    }

    if (tool === 'count') {
      if (!productId) { setErr('Pick a product first.'); return; }
      await saveItem('count', [pt], 1);
      return;
    }

    if (tool === 'linear' || tool === 'area') {
      if (!productId) { setErr('Pick a product first.'); return; }
      if (!ftPerUnit) { setErr('Calibrate the page scale first (Calibrate tool).'); return; }
      setErr('');
      setDraft((d) => [...d, pt]);
      return;
    }

    if (tool === 'wall') {
      if (!ftPerUnit) { setErr('Calibrate the page scale first (Calibrate tool).'); return; }
      setErr('');
      setDraft((d) => [...d, pt]);
      return;
    }

    if (tool === 'pickwall') {
      if (!ftPerUnit) { setErr('Calibrate the page scale first (Calibrate tool).'); return; }
      // Pixel source: rendered PDF canvas (at current zoom) or the image.
      let src, s;
      if (isImage) {
        const img = imgRef.current;
        if (!img?.naturalWidth) { setErr('Image not ready yet.'); return; }
        src = document.createElement('canvas');
        src.width = img.naturalWidth; src.height = img.naturalHeight;
        src.getContext('2d').drawImage(img, 0, 0);
        s = 1;
      } else {
        src = canvasRef.current;
        if (!src?.width) { setErr('Drawing not rendered yet.'); return; }
        s = zoom;
      }
      try {
        const seg = autoTraceWall(src, Math.round(pt[0] * s), Math.round(pt[1] * s));
        if (!seg) {
          setErr('No line found there — click directly on the wall line (zoom in helps), or trace it with the Wall tool.');
          return;
        }
        const a = [seg[0][0] / s, seg[0][1] / s];
        const b = [seg[1][0] / s, seg[1][1] / s];
        const qty = dist(a, b) * ftPerUnit;
        if (qty < 1) { setErr('Traced line is too short to be a wall.'); return; }
        setErr('');
        await saveItem('wall', [a, b], qty);
      } catch (e) {
        setErr(`Trace failed: ${e.message || e}`);
      }
      return;
    }

    if (tool === 'region') {
      if (draft.length === 0) { setDraft([pt]); return; }
      const p0 = draft[0];
      setDraft([]);
      const rect = {
        x: Math.min(p0[0], pt[0]),
        y: Math.min(p0[1], pt[1]),
        w: Math.abs(pt[0] - p0[0]),
        h: Math.abs(pt[1] - p0[1]),
      };
      if (rect.w < 10 || rect.h < 10) return;
      const next = { ...(file.plan_regions || {}), [page]: rect };
      setFile((f) => ({ ...f, plan_regions: next }));
      await supabase.from('project_files').update({ plan_regions: next }).eq('id', fileId);
      return;
    }

    if (tool === 'select') {
      // Hit test: nearest item within ~8 screen px.
      const tol = 8 / zoom;
      let best = null, bestD = Infinity;
      for (const it of items.filter((x) => x.page === page)) {
        const pts = it.points || [];
        let d = Infinity;
        if (it.tool === 'count') d = dist(pt, pts[0] || [1e9, 1e9]);
        else {
          const closed = it.tool === 'area';
          const n = pts.length;
          for (let i = 0; i < (closed ? n : n - 1); i++) {
            d = Math.min(d, segDist(pt, pts[i], pts[(i + 1) % n]));
          }
        }
        if (d < bestD) { bestD = d; best = it; }
      }
      setSelected(bestD <= tol ? best.id : null);
    }
  };

  const onOverlayDblClick = (evt) => {
    evt.preventDefault();
    if (tool === 'linear' || tool === 'area' || tool === 'wall') finishDraft();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setDraft([]);
      if (e.key === 'Enter') finishDraft();
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected &&
          !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        deleteItem(selected);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishDraft, selected]);

  // Clear transient state when switching pages/tools.
  useEffect(() => { setDraft([]); setSelected(null); }, [page, tool]);

  // ---------- aggregation ----------
  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  const groups = useMemo(() => {
    const g = {};
    for (const it of items) {
      const key = it.product_id || '_none';
      if (!g[key]) g[key] = { product: productById[it.product_id], qty: 0, count: 0 };
      g[key].qty += Number(it.qty || 0);
      g[key].count += 1;
    }
    return g;
  }, [items, productById]);

  const sendToEstimate = async () => {
    const entries = Object.entries(groups).filter(([k, v]) => k !== '_none' && v.product);
    if (!entries.length) { setErr('No product takeoff to send yet.'); return; }
    setBusy(true); setErr('');

    const linesPayload = entries.map(([pid, v], i) => {
      const p = productById[pid];
      const c = computeProductCost(p);
      return {
        kind: 'product',
        product_id: pid,
        description: `${p.name}${p.category ? ` (${p.category})` : ''} — takeoff`,
        quantity: Number(v.qty.toFixed(2)),
        unit: p.unit,
        unit_cost: Number(c.total.toFixed(4)),
        waste_pct: 0,
        sort_order: i,
      };
    });
    const subtotal = linesPayload.reduce((s, l) => s + l.quantity * l.unit_cost, 0);

    const { data: est, error: ee } = await supabase.from('estimates').insert({
      project_id: file.project_id,
      name: `Takeoff — ${file.name}`,
      status: 'draft',
      markup_pct: 15,
      tax_pct: 0,
      total_amount: subtotal * 1.15,
    }).select('id').single();
    if (ee) { setBusy(false); setErr(ee.message); return; }

    const { error: le } = await supabase.from('estimate_lines').insert(
      linesPayload.map((l) => ({ ...l, estimate_id: est.id }))
    );
    setBusy(false);
    if (le) { setErr(le.message); return; }
    nav(`/estimates/${est.id}`);
  };

  // ---------- product filter per tool ----------
  const pickableProducts = useMemo(() => {
    const unit = TOOL_UNIT[tool];
    if (!unit) return products;
    return products.filter((p) => p.unit === unit);
  }, [products, tool]);

  // Keep the picked product valid for the tool.
  useEffect(() => {
    if (productId && (tool in TOOL_UNIT) && !pickableProducts.some((p) => p.id === productId)) {
      setProductId(pickableProducts[0]?.id || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // ---------- render ----------
  if (loading) return <div style={{ padding: 32 }} className="muted">Loading drawing…</div>;
  if (!file)   return <div style={{ padding: 32 }} className="muted">Drawing not found. <Link to="/projects">← Projects</Link></div>;

  const pageItems = items.filter((x) => x.page === page);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 0, height: 'calc(100vh - 56px)' }}>
      {/* ============ canvas area ============ */}
      <div style={{ overflow: 'auto', background: '#3A3F3C', position: 'relative' }}>
        <div style={{ padding: 16, display: 'inline-block' }}>
          <div style={{ position: 'relative', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
            {isImage ? (
              <img
                ref={imgRef}
                src={signedUrl}
                alt={file.name}
                crossOrigin="anonymous"
                onLoad={onImgLoad}
                style={{ display: 'block', width: pageSize.w * zoom || 'auto' }}
              />
            ) : (
              <canvas ref={canvasRef} style={{ display: 'block', background: '#fff' }} />
            )}

            {/* drawing overlay */}
            <svg
              ref={overlayRef}
              width={pageSize.w * zoom}
              height={pageSize.h * zoom}
              onClick={onOverlayClick}
              onDoubleClick={onOverlayDblClick}
              style={{
                position: 'absolute', inset: 0,
                cursor: tool === 'select' ? 'default' : 'crosshair',
              }}
            >
              {/* saved items */}
              {pageItems.map((it) => {
                const color = it.product_id ? colorFor(it.product_id) : '#E45757';
                const pts = (it.points || []).map(([x, y]) => [x * zoom, y * zoom]);
                const isSel = selected === it.id;
                const stroke = isSel ? '#FFD54A' : color;
                if (it.tool === 'count') {
                  const [cx, cy] = pts[0] || [0, 0];
                  return (
                    <g key={it.id}>
                      <circle cx={cx} cy={cy} r={9} fill={color} opacity={0.85} stroke={isSel ? '#FFD54A' : '#fff'} strokeWidth={2} />
                    </g>
                  );
                }
                if (it.tool === 'wall') {
                  return (
                    <g key={it.id}>
                      <polyline
                        points={pts.map((p) => p.join(',')).join(' ')}
                        fill="none" stroke={isSel ? '#FFD54A' : '#37474F'} strokeWidth={6}
                        strokeLinecap="round" strokeLinejoin="round" opacity={0.75}
                      />
                    </g>
                  );
                }
                if (it.tool === 'linear') {
                  const [lx, ly] = centroid(pts);
                  return (
                    <g key={it.id}>
                      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={stroke} strokeWidth={3} strokeLinecap="round" />
                      <text x={lx} y={ly - 6} fontSize={12} fontWeight={700} fill={stroke} stroke="#fff" strokeWidth={3} paintOrder="stroke">
                        {Number(it.qty).toFixed(1)} LF
                      </text>
                    </g>
                  );
                }
                const [ax, ay] = centroid(pts);
                return (
                  <g key={it.id}>
                    <polygon points={pts.map((p) => p.join(',')).join(' ')} fill={color} fillOpacity={0.25} stroke={stroke} strokeWidth={2} />
                    <text x={ax} y={ay} fontSize={12} fontWeight={700} fill={stroke} stroke="#fff" strokeWidth={3} paintOrder="stroke" textAnchor="middle">
                      {Number(it.qty).toFixed(1)} SF
                    </text>
                  </g>
                );
              })}

              {/* designated floor-plan region */}
              {file.plan_regions?.[page] && (() => {
                const r = file.plan_regions[page];
                return (
                  <rect
                    x={r.x * zoom} y={r.y * zoom} width={r.w * zoom} height={r.h * zoom}
                    fill="none" stroke="#7E57C2" strokeWidth={2.5} strokeDasharray="10 6"
                  />
                );
              })()}

              {/* in-progress draft */}
              {draft.length > 0 && (
                <g>
                  {(tool === 'linear' || tool === 'calibrate' || tool === 'wall' || tool === 'region') && (
                    <polyline
                      points={draft.map(([x, y]) => `${x * zoom},${y * zoom}`).join(' ')}
                      fill="none" stroke="#FFD54A" strokeWidth={2} strokeDasharray="6 4"
                    />
                  )}
                  {tool === 'area' && draft.length >= 2 && (
                    <polygon
                      points={draft.map(([x, y]) => `${x * zoom},${y * zoom}`).join(' ')}
                      fill="#FFD54A" fillOpacity={0.15} stroke="#FFD54A" strokeWidth={2} strokeDasharray="6 4"
                    />
                  )}
                  {draft.map(([x, y], i) => (
                    <circle key={i} cx={x * zoom} cy={y * zoom} r={4} fill="#FFD54A" />
                  ))}
                </g>
              )}
            </svg>
          </div>
        </div>
      </div>

      {/* ============ right rail ============ */}
      <div style={{ borderLeft: '1px solid var(--border)', background: 'var(--surface)', overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
          <Link to={`/projects/${file.project_id}`} style={{ fontSize: 12.5 }}>← Back to project</Link>
        </div>

        {/* page / zoom */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {!isImage && numPages > 1 && (
            <>
              <button className="btn sm ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
              <span style={{ fontSize: 12.5 }}>Page {page}/{numPages}</span>
              <button className="btn sm ghost" disabled={page >= numPages} onClick={() => setPage((p) => p + 1)}>›</button>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn sm ghost" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))}>−</button>
          <span style={{ fontSize: 12.5, width: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button className="btn sm ghost" onClick={() => setZoom((z) => Math.min(4, +(z + 0.2).toFixed(2)))}>+</button>
        </div>

        {/* scale status */}
        <div style={{
          padding: '8px 10px', borderRadius: 6, fontSize: 12.5,
          background: ftPerUnit ? '#E7F3E7' : '#FEF3D7',
          color: ftPerUnit ? '#2E6F2E' : '#6B4B00',
        }}>
          {ftPerUnit
            ? <>Page scale set — 100 px ≈ {(ftPerUnit * 100).toFixed(2)} ft</>
            : <>Not calibrated. Use <b>Calibrate</b>: click two points of a known dimension.</>}
        </div>

        {/* tools */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 6 }}>Tool</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={`btn sm ${tool === t.id ? 'primary' : 'ghost'}`}
                onClick={() => setTool(t.id)}
                title={t.hint}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            {TOOLS.find((t) => t.id === tool)?.hint}
          </div>
        </div>

        {/* product picker */}
        {(tool === 'count' || tool === 'linear' || tool === 'area') && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 6 }}>
              Product ({TOOL_UNIT[tool]})
            </div>
            {pickableProducts.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5 }}>
                No {TOOL_UNIT[tool]} products yet. <Link to="/products/new">Create one →</Link>
              </div>
            ) : (
              <select
                className="org-switcher"
                style={{ width: '100%' }}
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">— pick a product —</option>
                {pickableProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.category ? ` — ${p.category}` : ''}</option>
                ))}
              </select>
            )}
            {productId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: colorFor(productId), display: 'inline-block' }} />
                <span className="muted">marker color on drawing</span>
              </div>
            )}
          </div>
        )}

        {err && <div className="auth-err" style={{ fontSize: 12.5 }}>{err}</div>}

        {/* takeoff summary */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 6 }}>
            Takeoff totals
          </div>
          {Object.keys(groups).length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5 }}>Nothing measured yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {Object.entries(groups).map(([pid, g]) => (
                <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '6px 8px', background: 'var(--surface-alt)', borderRadius: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: pid === '_none' ? '#E45757' : colorFor(pid), flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {g.product?.name || 'Unassigned'}
                  </span>
                  <b>{g.qty.toFixed(1)} {g.product?.unit || ''}</b>
                </div>
              ))}
            </div>
          )}

          {/* per-page item list w/ delete */}
          {pageItems.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', margin: '12px 0 6px' }}>
                This page
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                {pageItems.map((it) => (
                  <div
                    key={it.id}
                    onClick={() => setSelected(it.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 8px',
                      borderRadius: 5, cursor: 'pointer',
                      background: selected === it.id ? '#FFF3CD' : 'transparent',
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: it.product_id ? colorFor(it.product_id) : '#E45757', flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {productById[it.product_id]?.name || 'Unassigned'} · {it.tool}
                    </span>
                    <span className="muted">{Number(it.qty).toFixed(1)}</span>
                    <button
                      className="btn sm ghost"
                      style={{ padding: '1px 7px' }}
                      onClick={(e) => { e.stopPropagation(); deleteItem(it.id); }}
                    >×</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <Link
          to={`/takeoff3d/${fileId}?page=${page}`}
          className="btn"
          style={{ textAlign: 'center' }}
          title={ftPerUnit ? 'Extrude walls and view products in 3D' : 'Calibrate the scale first'}
        >
          View in 3D ⌁
        </Link>
        <button className="btn primary" onClick={sendToEstimate} disabled={busy}>
          {busy ? 'Sending…' : 'Send totals to estimate →'}
        </button>
      </div>
    </div>
  );
}
