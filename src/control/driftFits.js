// Sampled data and fitted drifts for the "unknown drift" slides (pure JS: no DOM, so it is testable).
//
// The data: a time series that roughly circles the initial basin's fixed point (from the true flow, with a little
// jitter) and a single sample in the target basin. The fits use only the time series:
//   fit 1  a kernel average of the sampled velocities: the gyre where there is data, still water everywhere else
//   fit 2  one linear model  x' = A x + b, extrapolated everywhere (as DGC does with its A[k])
//   fit 3  a quadratic polynomial drift (12 parameters): a better match to the data, extrapolating very differently
import { FlowField } from '../river/flowfield.js';

/** Display names of the fitting methods (shared by both slides). */
export const FIT_METHODS = { fit1: 'Moving average', fit2: 'Linear regression', fit3: 'Quadratic regression' };

export const SERIES = { count: 26, every: 28, from: -40 }; // samples, seconds apart, start offset (m) below the fixed point
const JITTER = 3;            // meters of measurement noise
const MAX_SPEED = 1.6;       // fitted fields are clipped to a plausible speed (m/s) when extrapolated

/** Point of slowest flow near (x, y): the basin's fixed point. */
export function fixedPoint(flow, x, y, r = 60) {
  let best = [x, y, Infinity];
  for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) {
    const s = flow.speedAt(x + dx, y + dy);
    if (s < best[2]) best = [x + dx, y + dy, s];
  }
  return best;
}

/** Positions along the true flow, p' = w(p), every `every` seconds (RK4, 4 s steps). */
export function sampleSeries(flow, p, count, every) {
  const w = [0, 0], f = (q) => { flow.velocity(q[0], q[1], w); return [w[0], w[1]]; };
  const out = [p.slice()], h = 4, steps = Math.round(every / h);
  for (let i = 1; i < count; i++) {
    for (let s = 0; s < steps; s++) {
      const k1 = f(p), k2 = f([p[0] + 0.5 * h * k1[0], p[1] + 0.5 * h * k1[1]]);
      const k3 = f([p[0] + 0.5 * h * k2[0], p[1] + 0.5 * h * k2[1]]), k4 = f([p[0] + h * k3[0], p[1] + h * k3[1]]);
      p = [p[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), p[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
    }
    out.push(p.slice());
  }
  return out;
}

// deterministic jitter, so the "data" is the same on every visit
export function jitter(points, amp) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return points.map(([x, y]) => [x + amp * rnd(), y + amp * rnd()]);
}

/** Velocity estimates from the time series (central differences): [{ x, y, vx, vy }]. */
export function velocitySamples(series, dt) {
  const out = [];
  for (let i = 1; i < series.length - 1; i++) {
    out.push({ x: series[i][0], y: series[i][1], vx: (series[i + 1][0] - series[i - 1][0]) / (2 * dt), vy: (series[i + 1][1] - series[i - 1][1]) / (2 * dt) });
  }
  return out;
}

/** Least-squares fit of w(p) = A (p - m) + b. Returns (x, y, out) -> out = [u, v]. */
export function fitLinear(samples) {
  const n = samples.length, mx = samples.reduce((s, q) => s + q.x, 0) / n, my = samples.reduce((s, q) => s + q.y, 0) / n;
  // normal equations for [dx dy 1] theta = v, one per velocity component
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rx = [0, 0, 0], ry = [0, 0, 0];
  for (const q of samples) {
    const r = [q.x - mx, q.y - my, 1];
    for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b]; rx[a] += r[a] * q.vx; ry[a] += r[a] * q.vy; }
  }
  const solve = (A, y) => { // 3x3 Gaussian elimination
    const m = A.map((row, i) => [...row, y[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
      [m[c], m[p]] = [m[p], m[c]];
      for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
    }
    return m.map((row, i) => row[3] / row[i]);
  };
  const tx = solve(M, rx), ty = solve(M, ry);
  return (x, y, out) => { out[0] = tx[0] * (x - mx) + tx[1] * (y - my) + tx[2]; out[1] = ty[0] * (x - mx) + ty[1] * (y - my) + ty[2]; return out; };
}

/** Kernel (Nadaraya-Watson) average of the samples; `conf` is how much data supports each point (0..1). */
export function fitKernel(samples, sigma = 35, eps = 0.4) {
  return (x, y, out) => {
    let sw = 0, su = 0, sv = 0;
    for (const q of samples) {
      const k = Math.exp(-((x - q.x) ** 2 + (y - q.y) ** 2) / (2 * sigma * sigma));
      sw += k; su += k * q.vx; sv += k * q.vy;
    }
    out[0] = su / (sw + eps); out[1] = sv / (sw + eps); out[2] = sw / (sw + eps);
    return out;
  };
}

/**
 * Least-squares fit of a quadratic polynomial drift: each velocity component is
 * c0 + c1 dx + c2 dy + c3 dx^2 + c4 dx dy + c5 dy^2, with (dx, dy) centered and scaled.
 * The samples lie close to a circle, which makes dx^2 + dy^2 nearly constant (nearly redundant with c0),
 * so a tiny ridge penalty on the quadratic terms keeps the problem well-posed.
 */
export function fitQuadratic(samples, ridge = 1e-3) {
  const n = samples.length;
  const mx = samples.reduce((a, q) => a + q.x, 0) / n, my = samples.reduce((a, q) => a + q.y, 0) / n;
  const sc = Math.sqrt(samples.reduce((a, q) => a + (q.x - mx) ** 2 + (q.y - my) ** 2, 0) / n) || 1;
  const feat = (x, y) => { const a = (x - mx) / sc, b = (y - my) / sc; return [1, a, b, a * a, a * b, b * b]; };
  const d = 6, M = Array.from({ length: d }, () => new Array(d).fill(0)), rx = new Array(d).fill(0), ry = new Array(d).fill(0);
  for (const q of samples) {
    const f = feat(q.x, q.y);
    for (let i = 0; i < d; i++) { for (let j = 0; j < d; j++) M[i][j] += f[i] * f[j]; rx[i] += f[i] * q.vx; ry[i] += f[i] * q.vy; }
  }
  for (let i = 3; i < d; i++) M[i][i] += ridge * n;
  const solve = (A, y) => { // Gaussian elimination with partial pivoting
    const m = A.map((row, i) => [...row, y[i]]);
    for (let c = 0; c < d; c++) {
      let p = c; for (let r = c + 1; r < d; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
      [m[c], m[p]] = [m[p], m[c]];
      for (let r = 0; r < d; r++) if (r !== c) { const k = m[r][c] / m[c][c]; for (let j = c; j <= d; j++) m[r][j] -= k * m[c][j]; }
    }
    return m.map((row, i) => row[d] / row[i]);
  };
  const cx = solve(M, rx), cy = solve(M, ry);
  return (x, y, out) => {
    const f = feat(x, y);
    out[0] = 0; out[1] = 0;
    for (let i = 0; i < d; i++) { out[0] += cx[i] * f[i]; out[1] += cy[i] * f[i]; }
    return out;
  };
}

/** RMS mismatch (m/s) between a fitted drift and the sampled velocities. */
export function fitResidual(fn, samples) {
  const o = [0, 0, 0];
  let s2 = 0;
  for (const q of samples) { fn(q.x, q.y, o); s2 += (o[0] - q.vx) ** 2 + (o[1] - q.vy) ** 2; }
  return Math.sqrt(s2 / samples.length);
}

/** A FlowField on the actual river's grid, from a velocity function (clipped to MAX_SPEED). */
export function fieldFrom(actual, fn) {
  const { nx, ny, cell } = actual, u = new Float32Array(nx * ny), v = new Float32Array(nx * ny), o = [0, 0, 0];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    fn((i + 0.5) * cell, (j + 0.5) * cell, o, k);
    const s = Math.hypot(o[0], o[1]), c = s > MAX_SPEED ? MAX_SPEED / s : 1;
    u[k] = o[0] * c; v[k] = o[1] * c;
  }
  return new FlowField({ ...actual, u, v });
}

export function buildFits(actual, series, dt) {
  const samples = velocitySamples(series, dt);
  const lin = fitLinear(samples), ker = fitKernel(samples), quad = fitQuadratic(samples);
  const fit1 = fieldFrom(actual, (x, y, o) => ker(x, y, o));
  const fit2 = fieldFrom(actual, (x, y, o) => lin(x, y, o));
  const fit3 = fieldFrom(actual, (x, y, o) => quad(x, y, o));
  const residuals = { fit1: fitResidual(ker, samples), fit2: fitResidual(lin, samples), fit3: fitResidual(quad, samples) };
  return { fit1, fit2, fit3, residuals };
}


/**
 * Everything both slides need, from the scenario's actual flow (the triangle of gyres).
 * The initial basin (time series) is the third swirl; the target basin (single sample) is the second.
 */
export function makeDriftData(flow, scn) {
  const [, bTarget, bInitial] = scn.swirls;
  const cI = fixedPoint(flow, bInitial.x, bInitial.y), cT = fixedPoint(flow, bTarget.x, bTarget.y);
  const series = jitter(sampleSeries(flow, [cI[0], cI[1] + SERIES.from], SERIES.count, SERIES.every), JITTER);
  const single = jitter([[cT[0] + 30, cT[1] + 22]], JITTER)[0];
  return {
    series, single, basinInitial: bInitial, basinTarget: bTarget, fits: buildFits(flow, series, SERIES.every),
  };
}
