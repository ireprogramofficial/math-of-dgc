// Evenly spaced streamlines of a flow field (a light version of Jobard & Lefer, 1997).
// Seeds are tried on a grid; each is traced forward and backward along the flow direction and stops when it
// leaves the water, stalls, or comes too close to a streamline already drawn. The result is a set of fixed
// "rails" the moving streaks visibly ride on, a static cue that the flow is deterministic.

/**
 * @returns {Float32Array} line segments as [x0, y0, x1, y1, ...] in world meters (pairs for gl.LINES)
 */
export function computeStreamlines(flow, { sep = 22, step = 3, maxLen = 1800, minLen = 60 } = {}) {
  const cell = sep / 2, gw = Math.ceil(flow.width / cell), gh = Math.ceil(flow.height / cell);
  const grid = new Map(); // cell index -> list of points [x, y]
  const key = (x, y) => Math.floor(y / cell) * gw + Math.floor(x / cell);
  const near = (x, y, d) => {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), r = Math.ceil(d / cell);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
      const pts = grid.get(j * gw + i);
      if (pts) for (const p of pts) if (Math.hypot(p[0] - x, p[1] - y) < d) return true;
    }
    return false;
  };
  const add = (pts) => { for (const p of pts) { const k = key(p[0], p[1]); (grid.get(k) ?? grid.set(k, []).get(k)).push(p); } };
  const v = [0, 0];
  const dir = (x, y, out) => {
    flow.velocity(x, y, v);
    const s = Math.hypot(v[0], v[1]);
    if (s < 0.03) return false;
    out[0] = v[0] / s; out[1] = v[1] / s;
    return true;
  };

  // trace from (x, y) in direction sign (+1 forward, -1 backward); midpoint (RK2) steps on the unit direction
  const trace = (x, y, sign) => {
    const pts = [], d1 = [0, 0], d2 = [0, 0], x0 = x, y0 = y;
    for (let len = 0; len < maxLen; len += step) {
      if (!dir(x, y, d1)) break;
      const mx = x + 0.5 * step * sign * d1[0], my = y + 0.5 * step * sign * d1[1];
      if (!dir(mx, my, d2)) break;
      const nx = x + step * sign * d2[0], ny = y + step * sign * d2[1];
      if (!flow.isWater(nx, ny, 2) || near(nx, ny, 0.5 * sep)) break;
      if (len > 4 * sep && Math.hypot(nx - x0, ny - y0) < 0.5 * sep) { pts.closed = true; pts.push([x0, y0]); break; } // closed orbit (e.g. a gyre)
      x = nx; y = ny;
      pts.push([x, y]);
    }
    return pts;
  };

  const segs = [];
  const spacing = sep * 1.6;
  for (let y = spacing / 2; y < flow.height; y += spacing) {
    for (let x = spacing / 2; x < flow.width; x += spacing) {
      if (!flow.isWater(x, y, 4) || near(x, y, sep)) continue;
      const fwd = trace(x, y, 1), back = fwd.closed ? [] : trace(x, y, -1).reverse();
      const line = [...back, [x, y], ...fwd];
      if (line.length * step < minLen) continue;
      add(line);
      for (let i = 1; i < line.length; i++) segs.push(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    }
  }
  return Float32Array.from(segs);
}
