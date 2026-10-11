// Signed-distance shapes for describing river geometry.
// World units are meters, x to the right, y UP. sd(x, y) < 0 inside the shape.

export function disc(cx, cy, r) {
  return { sd: (x, y) => Math.hypot(x - cx, y - cy) - r };
}

export function rect(x0, y0, x1, y1) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
  return {
    sd: (x, y) => {
      const dx = Math.abs(x - cx) - hx, dy = Math.abs(y - cy) - hy;
      return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
    },
  };
}

/** Approximate SDF of a rotated ellipse (exact on the boundary, good within a few radii). */
export function ellipse(cx, cy, rx, ry, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot), k = Math.min(rx, ry);
  return {
    sd: (x, y) => {
      const dx = x - cx, dy = y - cy;
      const u = (c * dx + s * dy) / rx, v = (-s * dx + c * dy) / ry;
      return (Math.hypot(u, v) - 1) * k;
    },
  };
}

/** A channel following a polyline. `widths` is a number or one full width per point. */
export function tube(points, widths) {
  const n = points.length;
  const w = Array.isArray(widths) ? widths : new Array(n).fill(widths);
  const segs = [];
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay] = points[i], [bx, by] = points[i + 1];
    const dx = bx - ax, dy = by - ay;
    segs.push({ ax, ay, dx, dy, len2: dx * dx + dy * dy || 1e-9, wa: w[i], wb: w[i + 1] });
  }
  return {
    sd: (x, y) => {
      let best = Infinity;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        let t = ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / s.len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - (s.ax + t * s.dx), y - (s.ay + t * s.dy)) - 0.5 * (s.wa + t * (s.wb - s.wa));
        if (d < best) best = d;
      }
      return best;
    },
  };
}

export function union(...shapes) {
  return {
    sd: (x, y) => {
      let best = Infinity;
      for (let i = 0; i < shapes.length; i++) {
        const d = shapes[i].sd(x, y);
        if (d < best) best = d;
      }
      return best;
    },
  };
}

/** Densify control points with a Catmull-Rom spline (also interpolates an optional width array). */
export function spline(points, widths, perSegment = 10) {
  const n = points.length;
  const wArr = Array.isArray(widths) ? widths : new Array(n).fill(widths ?? 1);
  const P = (i) => points[Math.max(0, Math.min(n - 1, i))];
  const W = (i) => wArr[Math.max(0, Math.min(n - 1, i))];
  const cr = (p0, p1, p2, p3, t) =>
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  const pts = [], ws = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      pts.push([cr(P(i - 1)[0], P(i)[0], P(i + 1)[0], P(i + 2)[0], t), cr(P(i - 1)[1], P(i)[1], P(i + 1)[1], P(i + 2)[1], t)]);
      ws.push(cr(W(i - 1), W(i), W(i + 1), W(i + 2), t));
    }
  }
  pts.push(points[n - 1]);
  ws.push(wArr[n - 1]);
  return { points: pts, widths: ws };
}

/** Convenience: a smooth channel through control points. */
export function channel(points, widths, perSegment = 10) {
  const s = spline(points, widths, perSegment);
  return tube(s.points, s.widths);
}
