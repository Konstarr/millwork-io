/**
 * Shared wall-line tracer.
 *
 * Given a canvas with the drawing rendered on it and a click position in
 * canvas pixels, find the dark line under the cursor and walk it to both
 * ends (axis-aligned, gap-tolerant so wall tags and anti-aliasing don't
 * stop the trace). Returns [[x1,y1],[x2,y2]] in canvas pixels, or null if
 * there is no traceable line at the click.
 *
 * Used by the 2D takeoff's "Wall pick" tool and the 3D view's
 * click-the-plan wall creation.
 */
export function autoTraceWall(canvas, clickPx, clickPy) {
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
