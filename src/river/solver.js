// Builds a FlowField for a scenario.
//
// Potential flow: water velocity is -grad(phi), with Laplace's equation in the water, phi = 1 at the sources,
// phi = 0 at the sinks, and no flow through the banks (Neumann). Solved by red-black SOR on the water cells only,
// coarse-to-fine: each resolution seeds the next, so the expensive fine grid starts near its answer.
// Because flux is conserved, water speeds up in narrow channels and slows in wide basins automatically.
// A cross-channel profile then slows water near the banks.
//
// Pure JS with no DOM use, so it runs in a Web Worker, in the main thread, and in Node tests.

import { FlowField } from './flowfield.js';
import { getScenario, WORLD } from './scenarios.js';

export function computeFlow(scenarioOrId, { nx = 480, bankProfile = 45, tol = 2e-6 } = {}) {
  const scn = typeof scenarioOrId === 'string' ? getScenario(scenarioOrId) : scenarioOrId;
  const world = scn.world ?? WORLD;

  if (scn.type === 'analytic') {
    const g = rasterize(scn, world, nx);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      if (!g.water[k]) continue;
      const f = scn.field((i + 0.5) * g.cell, (j + 0.5) * g.cell);
      g.u[k] = f[0]; g.v[k] = f[1];
    }
    return finish(scn, g, { iterations: 0, residual: 0 });
  }

  // coarse-to-fine cascade
  const levels = [nx / 4, nx / 2, nx].map(Math.round);
  let prev = null;
  let stats = null;
  let grid = null;
  for (const n of levels) {
    grid = rasterize(scn, world, n);
    const last = n === nx;
    const phi0 = prev ? upsample(prev.phi, prev.grid, grid) : graphDistanceGuess(grid);
    const res = solvePhi(grid, phi0, { maxIter: last ? 6000 : 4000, tol: last ? tol : 2e-5 });
    stats = { iterations: res.iterations, residual: res.residual };
    prev = { grid, phi: res.phi };
  }
  velocityFromPhi(grid, prev.phi, bankProfile, scn.speedRef);
  return finish(scn, grid, stats);
}

function finish(scn, g, stats) {
  dilateIntoLand(g.u, g.v, g.water, g.nx, g.ny, 3);
  const flow = new FlowField({ nx: g.nx, ny: g.ny, cell: g.cell, width: g.width, height: g.height, u: g.u, v: g.v, inside: g.inside, speedRef: scn.speedRef });
  return { flow, stats };
}

function rasterize(scn, world, nx) {
  const { width, height } = world;
  const cell = width / nx, ny = Math.round(height / cell), N = nx * ny;
  const inside = new Float32Array(N), water = new Uint8Array(N);
  const dir = new Int8Array(N).fill(-1); // -1 free, else fixed phi (1 source, 0 sink)
  for (let j = 0; j < ny; j++) {
    const y = (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * cell, k = j * nx + i, sd = scn.water.sd(x, y);
      inside[k] = -sd;
      if (sd >= 0) continue;
      water[k] = 1;
      if (scn.sources?.some((s) => s.sd(x, y) < 0)) dir[k] = 1;
      if (scn.sinks?.some((s) => s.sd(x, y) < 0)) dir[k] = 0;
    }
  }
  return { nx, ny, cell, width, height, N, inside, water, dir, u: new Float32Array(N), v: new Float32Array(N) };
}

/** Initial guess: graph distance to the sinks through the water, mapped to [0, 1]. */
function graphDistanceGuess({ nx, N, water, dir }) {
  const phi = new Float32Array(N).fill(0.5), dist = new Int32Array(N).fill(-1), queue = [];
  for (let k = 0; k < N; k++) if (dir[k] === 0) { dist[k] = 0; queue.push(k); }
  let maxD = 1;
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head], d = dist[k], i = k % nx;
    for (const m of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k >= nx ? k - nx : -1, k < N - nx ? k + nx : -1]) {
      if (m >= 0 && water[m] && dist[m] < 0) { dist[m] = d + 1; if (d + 1 > maxD) maxD = d + 1; queue.push(m); }
    }
  }
  for (let k = 0; k < N; k++) if (water[k]) phi[k] = dist[k] >= 0 ? 1 - dist[k] / maxD : 0.5;
  for (let k = 0; k < N; k++) if (dir[k] >= 0) phi[k] = dir[k];
  return phi;
}

/** Masked bilinear interpolation of a coarse solution onto the fine water cells. */
function upsample(phiC, gc, gf) {
  const guess = graphDistanceGuess(gf);
  const phi = new Float32Array(gf.N).fill(0.5);
  for (let j = 0; j < gf.ny; j++) for (let i = 0; i < gf.nx; i++) {
    const k = j * gf.nx + i;
    if (!gf.water[k]) continue;
    if (gf.dir[k] >= 0) { phi[k] = gf.dir[k]; continue; }
    const fx = ((i + 0.5) * gf.cell) / gc.cell - 0.5, fy = ((j + 0.5) * gf.cell) / gc.cell - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
    let s = 0, w = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const ii = i0 + a, jj = j0 + b;
      if (ii < 0 || jj < 0 || ii >= gc.nx || jj >= gc.ny) continue;
      const m = jj * gc.nx + ii;
      if (!gc.water[m]) continue;
      const wt = (a ? tx : 1 - tx) * (b ? ty : 1 - ty);
      s += wt * phiC[m]; w += wt;
    }
    phi[k] = w > 1e-6 ? s / w : guess[k];
  }
  return phi;
}

function solvePhi({ nx, ny, N, water, dir }, phi, { maxIter, tol }) {
  const colors = [[], []];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (water[k] && dir[k] < 0) colors[(i + j) & 1].push(k);
  }
  const sets = colors.map((list) => {
    const idx = Int32Array.from(list), nb = new Int32Array(list.length * 4).fill(-1), cnt = new Uint8Array(list.length);
    list.forEach((k, a) => {
      const i = k % nx, n = [];
      if (i > 0 && water[k - 1]) n.push(k - 1);
      if (i < nx - 1 && water[k + 1]) n.push(k + 1);
      if (k >= nx && water[k - nx]) n.push(k - nx);
      if (k < N - nx && water[k + nx]) n.push(k + nx);
      cnt[a] = n.length;
      n.forEach((m, b) => (nb[a * 4 + b] = m));
    });
    return { idx, nb, cnt };
  });

  const omega = 1.93;
  let iter = 0, resid = Infinity;
  for (; iter < maxIter; iter++) {
    let maxDelta = 0;
    for (let c = 0; c < 2; c++) {
      const { idx, nb, cnt } = sets[c];
      for (let a = 0; a < idx.length; a++) {
        const n = cnt[a];
        if (!n) continue;
        let s = 0;
        for (let b = 0; b < n; b++) s += phi[nb[a * 4 + b]];
        const k = idx[a], delta = omega * (s / n - phi[k]);
        phi[k] += delta;
        const ad = delta < 0 ? -delta : delta;
        if (ad > maxDelta) maxDelta = ad;
      }
    }
    resid = maxDelta;
    if (maxDelta < tol) { iter++; break; }
  }
  return { phi, iterations: iter, residual: resid };
}

/** Fills g.u, g.v: -grad(phi) (one-sided at banks) * cross-channel profile, smoothed, normalized to speedRef. */
function velocityFromPhi(g, phi, bankProfile, speedRef) {
  const { nx, ny, N, cell, water, inside, u, v } = g;
  const raw = new Float32Array(N * 2);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!water[k]) continue;
    const L = i > 0 && water[k - 1], R = i < nx - 1 && water[k + 1], D = j > 0 && water[k - nx], U = j < ny - 1 && water[k + nx];
    const gx = L && R ? (phi[k + 1] - phi[k - 1]) / (2 * cell) : R ? (phi[k + 1] - phi[k]) / cell : L ? (phi[k] - phi[k - 1]) / cell : 0;
    const gy = D && U ? (phi[k + nx] - phi[k - nx]) / (2 * cell) : U ? (phi[k + nx] - phi[k]) / cell : D ? (phi[k] - phi[k - nx]) / cell : 0;
    // ~25% of mid-channel speed at the bank, 100% beyond `bankProfile` meters out.
    const t = Math.min(Math.max(inside[k] / bankProfile, 0), 1);
    const prof = 0.25 + 0.75 * (1 - (1 - t) * (1 - t));
    raw[2 * k] = -gx * prof; raw[2 * k + 1] = -gy * prof;
  }

  // One light smoothing pass over water neighbors (removes staircase noise from the raster banks).
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!water[k]) continue;
    let sx = 4 * raw[2 * k], sy = 4 * raw[2 * k + 1], w = 4;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const m = jj * nx + ii;
      if (!water[m]) continue;
      const wt = di && dj ? 1 : 2;
      sx += wt * raw[2 * m]; sy += wt * raw[2 * m + 1]; w += wt;
    }
    u[k] = sx / w; v[k] = sy / w;
  }

  // Normalize so the 95th-percentile speed equals speedRef; soft-cap the extremes near sinks/sources.
  const speeds = [];
  for (let k = 0; k < N; k++) if (water[k]) speeds.push(Math.hypot(u[k], v[k]));
  speeds.sort((a, b) => a - b);
  const p95 = speeds[Math.floor(0.95 * (speeds.length - 1))] || 1;
  const scale = speedRef / p95, cap = 1.5 * speedRef;
  for (let k = 0; k < N; k++) {
    if (!water[k]) continue;
    let ux = u[k] * scale, vy = v[k] * scale;
    const s = Math.hypot(ux, vy);
    if (s > cap) { ux *= cap / s; vy *= cap / s; }
    u[k] = ux; v[k] = vy;
  }
}

/** Extend velocities a few cells into land so bilinear sampling right at the bank doesn't fade to zero. */
function dilateIntoLand(u, v, water, nx, ny, passes) {
  const known = Uint8Array.from(water);
  for (let p = 0; p < passes; p++) {
    const add = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (known[k]) continue;
      let sx = 0, sy = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const m = jj * nx + ii;
        if (known[m]) { sx += u[m]; sy += v[m]; c++; }
      }
      if (c) add.push([k, sx / c, sy / c]);
    }
    for (const [k, ux, vy] of add) { u[k] = ux; v[k] = vy; known[k] = 1; }
  }
}
