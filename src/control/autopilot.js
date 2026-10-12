// A feedback autopilot for the boat: it picks a destination in the water, plans a path with A*, and follows
// it with pure pursuit. When it arrives it holds position for a moment, then picks somewhere new. It is a
// *closed-loop* controller (thrust depends on the current state), in contrast to the open-loop schedules
// elsewhere in the deck.
//
// Control law (w = water velocity, s = thrust speed; the boat's velocity is x' = w + G u):
//   v_des  = cruise speed toward the lookahead point on the path (slowing near the destination),
//            plus a push away from nearby banks
//   G u    = v_des - w                          cancel the current and add the desired velocity
//   u      = thruster fractions from the signs/magnitudes of (v_des - w) / s, scaled down to fit [0, 1]

import { NU } from './boat.js';

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const { k, v } = this;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const { k, v } = this;
    const top = v[0], lastK = k.pop(), lastV = v.pop();
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return top;
  }
}

const NEIGHBORS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

export class Autopilot {
  constructor(flow, scenario, model, opts = {}) {
    this.flow = flow;
    this.model = model;
    this.o = { margin: 16, step: 2, cruise: 2.6, lookahead: 60, holdSeconds: 2.2, arriveRadius: 12, minTrip: 250, ...opts };
    const step = this.o.step;
    this.nx = Math.floor(flow.nx / step);
    this.ny = Math.floor(flow.ny / step);
    this.cell = flow.cell * step;
    const { nx, ny, cell } = this;
    const N = nx * ny;
    this.free = new Uint8Array(N);
    this.w = new Float32Array(N); // path cost: prefer mid-channel
    const ends = [...(scenario.sinks ?? []), ...(scenario.sources ?? [])];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * cell, y = (j + 0.5) * cell, k = j * nx + i;
      const ins = flow.insideAt(x, y);
      if (ins <= this.o.margin || x < 40 || y < 40 || x > flow.width - 40 || y > flow.height - 40) continue;
      if (ends.some((s) => s.sd(x, y) < 70)) continue; // never head for the inlet or outlet
      this.free[k] = 1;
      this.w[k] = 1 + 3 * Math.min(Math.max((45 - ins) / 45, 0), 1);
    }
    this._keepLargestComponent();
    this.goal = null;
    this.path = [];
    this.idx = 0;
    this.phase = 'travel';
    this.holdLeft = 0;
    this.recent = [];
    this._g = new Float64Array(3);
    this._wv = [0, 0];
    this.u = new Float64Array(NU);
  }

  _keepLargestComponent() {
    const { nx, ny, free } = this, N = nx * ny;
    const label = new Int32Array(N).fill(-1);
    let best = -1, bestSize = 0, id = 0;
    for (let s = 0; s < N; s++) {
      if (!free[s] || label[s] >= 0) continue;
      const stack = [s]; label[s] = id; let size = 0;
      while (stack.length) {
        const c = stack.pop(); size++;
        const ci = c % nx, cj = (c - ci) / nx;
        for (const [di, dj] of NEIGHBORS) {
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
          const m = j * nx + i;
          if (free[m] && label[m] < 0) { label[m] = id; stack.push(m); }
        }
      }
      if (size > bestSize) { bestSize = size; best = id; }
      id++;
    }
    for (let k = 0; k < N; k++) if (label[k] !== best) free[k] = 0;
    this.nodes = [];
    for (let k = 0; k < N; k++) if (free[k]) this.nodes.push(k);
  }

  _nodeXY(k) { const i = k % this.nx, j = (k - i) / this.nx; return [(i + 0.5) * this.cell, (j + 0.5) * this.cell]; }

  _nearestNode(x, y) {
    const { nx, ny, cell, free } = this;
    const ci = Math.min(Math.max(Math.floor(x / cell), 0), nx - 1), cj = Math.min(Math.max(Math.floor(y / cell), 0), ny - 1);
    for (let r = 0; r < Math.max(nx, ny); r++) {
      let best = -1, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (!free[k]) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** A* over the free nodes; returns [[x, y], ...] from near `from` to near `to`, or null. */
  planPath(from, to) {
    const { nx, free, w, cell } = this;
    const s = this._nearestNode(from[0], from[1]), t = this._nearestNode(to[0], to[1]);
    if (s < 0 || t < 0) return null;
    const N = this.nx * this.ny;
    const g = new Float32Array(N).fill(Infinity), parent = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const ti = t % nx, tj = (t - ti) / nx;
    const hfn = (k) => { const i = k % nx, j = (k - i) / nx; const dx = Math.abs(i - ti), dj = Math.abs(j - tj); return Math.max(dx, dj) + (Math.SQRT2 - 1) * Math.min(dx, dj); };
    const heap = new MinHeap();
    g[s] = 0; heap.push(hfn(s), s);
    while (heap.size) {
      const c = heap.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (c === t) break;
      const ci = c % nx, cj = (c - ci) / nx;
      for (const [di, dj, d] of NEIGHBORS) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= this.ny) continue;
        const m = j * nx + i;
        if (!free[m] || closed[m]) continue;
        // no cutting corners through land
        if (di && dj && (!free[cj * nx + i] || !free[j * nx + ci])) continue;
        const ng = g[c] + d * 0.5 * (w[c] + w[m]);
        if (ng < g[m]) { g[m] = ng; parent[m] = c; heap.push(ng + hfn(m), m); }
      }
    }
    if (!closed[t]) return null;
    const path = [];
    for (let k = t; k >= 0; k = parent[k]) path.push(this._nodeXY(k));
    path.reverse();
    return path.filter((_, i) => i % 2 === 0 || i === path.length - 1);
  }

  /** Pick a new destination far from the boat and from recent destinations, and plan to it. */
  newGoal(pos) {
    const { nodes } = this;
    for (let tries = 0; tries < 60; tries++) {
      const xy = this._nodeXY(nodes[Math.floor(Math.random() * nodes.length)]);
      if (Math.hypot(xy[0] - pos[0], xy[1] - pos[1]) < this.o.minTrip) continue;
      if (this.recent.some((r) => Math.hypot(xy[0] - r[0], xy[1] - r[1]) < 200)) continue;
      const path = this.planPath(pos, xy);
      if (!path) continue;
      this.goal = xy; this.path = path; this.idx = 0; this.phase = 'travel';
      this.recent.push(xy); if (this.recent.length > 3) this.recent.shift();
      return true;
    }
    this.goal = this.goal ?? [pos[0], pos[1]];
    return false;
  }

  /** Forget the current trip, e.g. after the user steered manually. */
  reset() { this.goal = null; this.path = []; this.phase = 'travel'; this.fixed = false; }

  /** Travel to one fixed destination and hold station there indefinitely. */
  goTo(goal, pos) {
    this.fixed = true;
    this.goal = [goal[0], goal[1]];
    this.path = this.planPath(pos, goal) ?? [this.goal];
    this.idx = 0;
    this.phase = 'travel';
  }

  /** Per-frame timers (real seconds): the pause at an arrival point. */
  tick(dtReal, pos) {
    if (this.phase === 'hold') {
      this.holdLeft -= dtReal;
      if (this.holdLeft <= 0 && !this.fixed) this.newGoal(pos);
    }
  }

  /** If the boat has barely moved for a while mid-trip, re-plan from where it actually is (and eventually pick a new goal). */
  _watchForStall(x, h) {
    const last = this._lastPos ?? [x[0], x[1]];
    const speed = h > 0 ? Math.hypot(x[0] - last[0], x[1] - last[1]) / h : 0;
    this._lastPos = [x[0], x[1]];
    if (this.phase !== 'travel') { this.stuck = 0; return; }
    this.stuck = speed < 0.35 ? (this.stuck ?? 0) + h : 0;
    if (this.stuck > 40) {
      const path = this.planPath([x[0], x[1]], this.goal);
      this.stuck = 0;
      this.stalls = (this.stalls ?? 0) + 1;
      if (path && this.stalls < 3) { this.path = path; this.idx = 0; }
      else { this.stalls = 0; this.newGoal([x[0], x[1]]); }
    }
  }

  /** Is the straight segment between two points over open water (with room to spare)? */
  _clear(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / 6));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (this.flow.insideAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) < 9) return false;
    }
    return true;
  }

  /** Thruster command u = (N, E, S, W) for state x = (px, py); h = sim seconds since the last call. */
  control(x, h = 0.4) {
    if (!this.goal) this.newGoal([x[0], x[1]]);
    if (!this.fixed) this._watchForStall(x, h);
    const { flow, o, model } = this;
    const px = x[0], py = x[1];
    const gx = this.goal[0] - px, gy = this.goal[1] - py, dGoal = Math.hypot(gx, gy);
    if (this.phase === 'travel' && dGoal < o.arriveRadius) { this.phase = 'hold'; this.holdLeft = o.holdSeconds; }

    let dx, dy, speed;
    if (this.phase === 'hold') {
      dx = gx; dy = gy; speed = Math.min(0.4 * dGoal, 1);
      const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
    } else {
      // Pure pursuit: skip path points already reached, then aim at the farthest point within the lookahead
      // distance that is visible over open water. The visibility test stops it cutting corners across land
      // (e.g. the wedge between two branches).
      const P = this.path, last = P.length - 1;
      // re-anchor on the closest path point nearby (the boat is pushed around by the current and the gyres)
      let best = this.idx, bd = Infinity;
      for (let m = Math.max(0, this.idx - 8); m <= Math.min(last, this.idx + 12); m++) {
        const d = Math.hypot(P[m][0] - px, P[m][1] - py);
        if (d < bd) { bd = d; best = m; }
      }
      this.idx = best;
      while (this.idx < last && Math.hypot(P[this.idx][0] - px, P[this.idx][1] - py) < 18) this.idx++;
      let k = this.idx;
      for (let m = this.idx + 1; m <= last; m++) {
        if (Math.hypot(P[m][0] - px, P[m][1] - py) > o.lookahead || !this._clear(px, py, P[m][0], P[m][1])) break;
        k = m;
      }
      const look = dGoal < o.lookahead && this._clear(px, py, this.goal[0], this.goal[1]) ? this.goal : P[k];
      dx = look[0] - px; dy = look[1] - py;
      const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
      speed = Math.min(o.cruise, 0.4 * dGoal);
    }
    let vdx = speed * dx, vdy = speed * dy;

    // keep off the banks
    const g = flow.insideAndGrad(px, py, this._g);
    if (g[0] < 13) { // narrower than the thinnest channels' half-width, so the centerline is never pushed around
      const gm = Math.hypot(g[1], g[2]) || 1, k = (1.6 * (13 - g[0])) / 13;
      vdx += (k * g[1]) / gm; vdy += (k * g[2]) / gm;
    }

    const w = flow.velocity(px, py, this._wv);
    let ux = (vdx - w[0]) / model.speed, uy = (vdy - w[1]) / model.speed;
    const m = Math.max(Math.abs(ux), Math.abs(uy), 1);
    ux /= m; uy /= m;
    this.u[0] = Math.max(uy, 0); this.u[2] = Math.max(-uy, 0);
    this.u[1] = Math.max(ux, 0); this.u[3] = Math.max(-ux, 0);
    return this.u;
  }
}
