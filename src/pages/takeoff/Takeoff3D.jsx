import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from '../../lib/supabase.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * 3D takeoff view.
 *
 * The designated plan region (or full page) is rendered flat on the ground
 * with the actual drawing as its texture. Walls stand up from it:
 *   - traced Wall items from the 2D takeoff (always)
 *   - auto-detected vector line segments from the PDF itself (beta toggle) —
 *     works best on CAD-exported sheets where walls are real vector lines.
 * Both extrude to an adjustable height at partial opacity, so you can see
 * into the space. Placed products render as colored solids: LF runs become
 * base-cabinet-sized boxes along their path, EA counts become units on the
 * floor, SF areas become tinted floor zones.
 *
 * Units: 1 three.js unit = 1 foot. Orbit to rotate, right-drag to pan,
 * wheel to zoom.
 */

function colorFor(id) {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return new THREE.Color(`hsl(${h}, 70%, 45%)`);
}

/**
 * Best-effort wall extraction from the PDF's vector operator list.
 * Walks constructPath ops, tracks the transform stack, converts everything
 * to viewport(scale 1) coordinates, and keeps segments that are long enough
 * to plausibly be walls. Curves are approximated by their chords.
 */
async function extractVectorSegments(pdfPage, region, ftPerUnit) {
  const OPS = pdfjsLib.OPS;
  const viewport = pdfPage.getViewport({ scale: 1 });
  const opList = await pdfPage.getOperatorList();

  const segs = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1],       m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],       m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const toV = (x, y) => {
    const ux = ctm[0] * x + ctm[2] * y + ctm[4];
    const uy = ctm[1] * x + ctm[3] * y + ctm[5];
    return viewport.convertToViewportPoint(ux, uy);
  };

  const minLenUnits = ftPerUnit ? (1.0 / ftPerUnit) : 8; // ≥ 1 ft
  const inRegion = ([x, y]) =>
    !region || (x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h);

  for (let i = 0; i < opList.fnArray.length && segs.length < 6000; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS.save)      { stack.push(ctm); continue; }
    if (fn === OPS.restore)   { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; continue; }
    if (fn === OPS.transform) { ctm = mul(ctm, args); continue; }
    if (fn !== OPS.constructPath) continue;

    try {
      const [ops, coords] = args;
      let k = 0, cur = null, start = null;
      for (const op of ops) {
        if (op === OPS.moveTo) {
          cur = toV(coords[k], coords[k + 1]); start = cur; k += 2;
        } else if (op === OPS.lineTo) {
          const nxt = toV(coords[k], coords[k + 1]); k += 2;
          if (cur) segs.push([cur, nxt]);
          cur = nxt;
        } else if (op === OPS.curveTo) {
          const nxt = toV(coords[k + 4], coords[k + 5]); k += 6;
          if (cur) segs.push([cur, nxt]);
          cur = nxt;
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          const nxt = toV(coords[k + 2], coords[k + 3]); k += 4;
          if (cur) segs.push([cur, nxt]);
          cur = nxt;
        } else if (op === OPS.closePath) {
          if (cur && start) segs.push([cur, start]);
          cur = start;
        } else if (op === OPS.rectangle) {
          const [x, y, w, h] = [coords[k], coords[k + 1], coords[k + 2], coords[k + 3]];
          k += 4;
          const a = toV(x, y), b = toV(x + w, y), c = toV(x + w, y + h), d = toV(x, y + h);
          segs.push([a, b], [b, c], [c, d], [d, a]);
          cur = a; start = a;
        }
      }
    } catch { /* skip malformed path */ }
  }

  // Filter: inside region, long enough to be a wall.
  return segs.filter(([a, b]) => {
    if (!inRegion(a) && !inRegion(b)) return false;
    return Math.hypot(b[0] - a[0], b[1] - a[1]) >= minLenUnits;
  }).slice(0, 4000);
}

export default function Takeoff3D() {
  const { fileId } = useParams();
  const [params]   = useSearchParams();
  const page       = Number(params.get('page') || 1);

  const mountRef = useRef(null);
  const worldRef = useRef(null);  // { scene, renderer, camera, controls, groups }

  const [file, setFile]       = useState(null);
  const [items, setItems]     = useState([]);
  const [products, setProducts] = useState([]);
  const [autoSegs, setAutoSegs] = useState([]);
  const [texture, setTexture]   = useState(null);
  const [region, setRegion]     = useState(null);
  const [ft, setFt]             = useState(0);

  const [wallH, setWallH]       = useState(9);
  const [wallOpacity, setWallOpacity] = useState(0.35);
  const [showAuto, setShowAuto] = useState(true);
  const [status, setStatus]     = useState('Loading drawing…');
  const [err, setErr]           = useState('');

  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  // ---------- load data + build texture + detect walls ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const f = await supabase.from('project_files').select('*').eq('id', fileId).maybeSingle();
      if (cancelled) return;
      if (!f.data) { setErr('Drawing not found.'); return; }
      const fr = f.data;
      setFile(fr);
      const ftPerUnit = Number((fr.scales || {})[page] || 0);
      setFt(ftPerUnit);
      if (!ftPerUnit) { setErr('This page is not calibrated. Go back and use the Calibrate tool first.'); return; }
      setWallH(Number(fr.wall_height_ft || 9));

      const [it, pd, su] = await Promise.all([
        supabase.from('takeoff_items').select('*').eq('file_id', fileId).eq('page', page),
        supabase.from('products').select('id, name, category, unit'),
        supabase.storage.from('drawings').createSignedUrl(fr.storage_path, 3600 * 6),
      ]);
      if (cancelled) return;
      setItems(it.data || []);
      setProducts(pd.data || []);
      if (su.error) { setErr(su.error.message); return; }

      setStatus('Rendering plan…');
      const isImage = (fr.mime_type || '').startsWith('image/');

      let reg = (fr.plan_regions || {})[page] || null;

      if (isImage) {
        const img = await new Promise((res, rej) => {
          const i = new Image();
          i.crossOrigin = 'anonymous';
          i.onload = () => res(i); i.onerror = rej;
          i.src = su.data.signedUrl;
        });
        if (!reg) reg = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
        const c = document.createElement('canvas');
        c.width = reg.w; c.height = reg.h;
        c.getContext('2d').drawImage(img, reg.x, reg.y, reg.w, reg.h, 0, 0, reg.w, reg.h);
        if (cancelled) return;
        setRegion(reg);
        setTexture(new THREE.CanvasTexture(c));
        setAutoSegs([]);           // no vectors in a raster image
        setStatus('');
        return;
      }

      const doc = await pdfjsLib.getDocument({ url: su.data.signedUrl }).promise;
      const pdfPage = await doc.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      if (!reg) reg = { x: 0, y: 0, w: base.width, h: base.height };

      // Render at 2x for a crisp floor texture, crop to the region.
      const RS = 2;
      const vp = pdfPage.getViewport({ scale: RS });
      const full = document.createElement('canvas');
      full.width = vp.width; full.height = vp.height;
      await pdfPage.render({ canvasContext: full.getContext('2d'), viewport: vp }).promise;
      const crop = document.createElement('canvas');
      crop.width = reg.w * RS; crop.height = reg.h * RS;
      crop.getContext('2d').drawImage(full, reg.x * RS, reg.y * RS, reg.w * RS, reg.h * RS, 0, 0, crop.width, crop.height);
      if (cancelled) return;
      setRegion(reg);
      setTexture(new THREE.CanvasTexture(crop));

      setStatus('Detecting walls…');
      try {
        const segs = await extractVectorSegments(pdfPage, reg, ftPerUnit);
        if (!cancelled) setAutoSegs(segs);
      } catch { if (!cancelled) setAutoSegs([]); }
      if (!cancelled) setStatus('');
    })();
    return () => { cancelled = true; };
  }, [fileId, page]);

  // ---------- build the three.js world ----------
  useEffect(() => {
    if (!texture || !region || !ft || !mountRef.current) return;

    const mount = mountRef.current;
    const W = region.w * ft;   // feet
    const H = region.h * ft;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#232826');

    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, 5000);
    camera.position.set(W * 0.5, Math.max(W, H) * 0.85, H * 1.25);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(W / 2, 0, H / 2);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(W, Math.max(W, H) * 1.2, H * 0.3);
    scene.add(sun);

    // floor: the drawing itself
    texture.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ map: texture })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, H / 2);
    scene.add(floor);

    const wallGroup = new THREE.Group();
    const autoGroup = new THREE.Group();
    const prodGroup = new THREE.Group();
    scene.add(wallGroup, autoGroup, prodGroup);

    worldRef.current = { scene, renderer, camera, controls, wallGroup, autoGroup, prodGroup };

    let raf;
    const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
    tick();

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      worldRef.current = null;
    };
  }, [texture, region, ft]);

  // ---------- (re)build walls + products whenever inputs change ----------
  useEffect(() => {
    const w = worldRef.current;
    if (!w || !region || !ft) return;

    const toFt = ([x, y]) => [(x - region.x) * ft, (y - region.y) * ft];

    const clear = (group) => {
      while (group.children.length) {
        const m = group.children.pop();
        m.geometry?.dispose(); m.material?.dispose();
        group.remove(m);
      }
    };
    clear(w.wallGroup); clear(w.autoGroup); clear(w.prodGroup);

    const wallSeg = (group, aU, bU, { height, thick, color, opacity }) => {
      const a = toFt(aU), b = toFt(bU);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.05) return;
      const geo = new THREE.BoxGeometry(len, height, thick);
      const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((a[0] + b[0]) / 2, height / 2, (a[1] + b[1]) / 2);
      mesh.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      group.add(mesh);
    };

    // traced walls
    for (const it of items.filter((x) => x.tool === 'wall')) {
      const pts = it.points || [];
      for (let i = 1; i < pts.length; i++) {
        wallSeg(w.wallGroup, pts[i - 1], pts[i], {
          height: wallH, thick: 0.45, color: '#8D9B94', opacity: wallOpacity,
        });
      }
    }

    // auto-detected vector walls
    if (showAuto) {
      for (const [a, b] of autoSegs) {
        wallSeg(w.autoGroup, a, b, {
          height: wallH, thick: 0.25, color: '#5C6B75', opacity: wallOpacity * 0.7,
        });
      }
    }

    // products
    for (const it of items.filter((x) => x.product_id)) {
      const color = colorFor(it.product_id);
      const pts = it.points || [];
      if (it.tool === 'count' && pts[0]) {
        const [x, z] = toFt(pts[0]);
        const geo = new THREE.BoxGeometry(2, 3, 2);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
        mesh.position.set(x, 1.5, z);
        w.prodGroup.add(mesh);
      } else if (it.tool === 'linear') {
        // cabinet-run style: 3 ft tall, 2 ft deep boxes along the path
        for (let i = 1; i < pts.length; i++) {
          const a = toFt(pts[i - 1]), b = toFt(pts[i]);
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 0.1) continue;
          const geo = new THREE.BoxGeometry(len, 3, 2);
          const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.9 }));
          mesh.position.set((a[0] + b[0]) / 2, 1.5, (a[1] + b[1]) / 2);
          mesh.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
          w.prodGroup.add(mesh);
        }
      } else if (it.tool === 'area' && pts.length >= 3) {
        const shape = new THREE.Shape(pts.map((p) => {
          const [x, z] = toFt(p);
          return new THREE.Vector2(x, z);
        }));
        const geo = new THREE.ShapeGeometry(shape);
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
        }));
        mesh.rotation.x = Math.PI / 2;   // shape built in x/z, lay flat
        mesh.position.y = 0.08;
        w.prodGroup.add(mesh);
      }
    }
  }, [items, autoSegs, showAuto, wallH, wallOpacity, region, ft, texture]);

  // persist wall height (debounced-ish, on commit)
  const saveWallH = async (v) => {
    setWallH(v);
    await supabase.from('project_files').update({ wall_height_ft: v }).eq('id', fileId);
  };

  const legend = useMemo(() => {
    const seen = new Map();
    for (const it of items.filter((x) => x.product_id)) {
      if (!seen.has(it.product_id)) seen.set(it.product_id, { qty: 0, p: productById[it.product_id] });
      seen.get(it.product_id).qty += Number(it.qty || 0);
    }
    return Array.from(seen.entries());
  }, [items, productById]);

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 56px)', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      {/* top-left: back + status */}
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Link to={`/takeoff/${fileId}`} className="btn sm" style={{ background: 'var(--surface)' }}>
          ← Back to 2D takeoff
        </Link>
        {(status || err) && (
          <div style={{
            padding: '8px 12px', borderRadius: 6, fontSize: 12.5, maxWidth: 320,
            background: err ? '#FBE9E7' : 'var(--surface)', color: err ? '#B3261E' : 'var(--text)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}>
            {err || status}
          </div>
        )}
      </div>

      {/* right rail: controls + legend */}
      {!err && (
        <div style={{
          position: 'absolute', top: 12, right: 12, width: 230, padding: 12,
          background: 'var(--surface)', borderRadius: 10, boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
          display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5,
        }}>
          <b>3D controls</b>
          <label style={{ display: 'grid', gap: 3 }}>
            Wall height: {wallH} ft
            <input type="range" min={7} max={20} step={0.5} value={wallH}
              onChange={(e) => setWallH(Number(e.target.value))}
              onMouseUp={(e) => saveWallH(Number(e.target.value))} />
          </label>
          <label style={{ display: 'grid', gap: 3 }}>
            Wall opacity: {Math.round(wallOpacity * 100)}%
            <input type="range" min={0.1} max={0.9} step={0.05} value={wallOpacity}
              onChange={(e) => setWallOpacity(Number(e.target.value))} />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={showAuto} onChange={(e) => setShowAuto(e.target.checked)} />
            Auto-detected walls <span className="muted">({autoSegs.length})</span>
          </label>
          <div className="muted" style={{ fontSize: 11.5 }}>
            Drag to orbit · right-drag to pan · scroll to zoom.
            Auto walls come from the PDF's vector lines (beta) — trace Wall
            lines in 2D for clean geometry.
          </div>

          {legend.length > 0 && (
            <>
              <b style={{ marginTop: 2 }}>Products in space</b>
              {legend.map(([pid, { qty, p }]) => (
                <div key={pid} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: `#${colorFor(pid).getHexString()}`, flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.name || '—'}</span>
                  <b>{qty.toFixed(1)} {p?.unit || ''}</b>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
