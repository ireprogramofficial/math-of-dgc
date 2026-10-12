// DGC-style drift: a linear *time-varying* model fit by rank-one updates of the identity between consecutive samples.
//
// Data are centered on their steady-state average  p_bar  (as DGC does):  z[k] = x(t_k) - p_bar.  For each step,
//   A[k] = I + (z[k+1] - z[k]) z[k]^T / (z[k]^T z[k])
// is the matrix closest to the identity (Frobenius norm) that maps z[k] exactly onto z[k+1]. The model
//   z[k+1] = A[k] z[k] + B u[k]
// therefore reproduces the time series exactly, and its drift depends on the step k, not on where the state is.
// Control is first-order here (as in DGC): thrust displaces the state, B u[k] meters per step.
//
// Planning: z[K] is linear in u, so  min || z[K] - z_target ||  over 0 <= u <= 1  is a (bounded) nonnegative
// least-squares problem, as in DGC (whose doses have no ceiling; the boat's thrusters do). A tiny ridge term spreads
// the thrust over the steps instead of spiking it into one or two of them.
// Pure JS (no DOM), so it is testable.

const NU = 4; // thrusters N, E, S, W

/** Fit the rank-one LTV model to a time series of 2-D points sampled every dt seconds. */
export function fitRankOneLTV(series, dt) {
  const n = series.length;
  const pbar = [series.reduce((s, p) => s + p[0], 0) / n, series.reduce((s, p) => s + p[1], 0) / n];
  const z = series.map((p) => [p[0] - pbar[0], p[1] - pbar[1]]);
  const A = [];
  for (let k = 0; k < n - 1; k++) {
    const a = z[k], d = [z[k + 1][0] - a[0], z[k + 1][1] - a[1]], aa = a[0] * a[0] + a[1] * a[1] || 1e-12;
    A.push([[1 + (d[0] * a[0]) / aa, (d[0] * a[1]) / aa], [(d[1] * a[0]) / aa, 1 + (d[1] * a[1]) / aa]]);
  }
  return { A, pbar, dt, steps: A.length };
}

const mul = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1], M[1][0] * v[0] + M[1][1] * v[1]];
const matmul = (P, Q) => [[P[0][0] * Q[0][0] + P[0][1] * Q[1][0], P[0][0] * Q[0][1] + P[0][1] * Q[1][1]], [P[1][0] * Q[0][0] + P[1][1] * Q[1][0], P[1][0] * Q[0][1] + P[1][1] * Q[1][1]]];

/** The model's drift at step k as a continuous-time velocity field: (A[k] - I)(p - p_bar) / dt. */
export function ltvDrift(model, k, x, y, out = [0, 0]) {
  const A = model.A[Math.min(Math.max(k, 0), model.steps - 1)];
  const zx = x - model.pbar[0], zy = y - model.pbar[1];
  out[0] = ((A[0][0] - 1) * zx + A[0][1] * zy) / model.dt;
  out[1] = (A[1][0] * zx + (A[1][1] - 1) * zy) / model.dt;
  return out;
}

/** Thrust displacement per step: full thrust moves the state (a/c) * dt meters (the boat's top speed times dt). */
export function thrustMatrix(boatModel, dt) {
  const s = (boatModel.a / boatModel.c) * dt;
  // columns N, E, S, W -> (east, north)
  return [[0, s, 0, -s], [s, 0, -s, 0]];
}

/** Simulate the model from x0 (world coords) with schedule U (K x 4): returns world positions p[0..K]. */
export function rolloutLTV(model, B, x0, U, K) {
  let z = [x0[0] - model.pbar[0], x0[1] - model.pbar[1]];
  const out = [[x0[0], x0[1]]];
  for (let k = 0; k < K; k++) {
    const az = mul(model.A[k], z), u = U.subarray ? U.subarray(NU * k, NU * k + NU) : U.slice(NU * k, NU * k + NU);
    z = [az[0] + B[0][0] * u[0] + B[0][1] * u[1] + B[0][2] * u[2] + B[0][3] * u[3], az[1] + B[1][0] * u[0] + B[1][1] * u[1] + B[1][2] * u[2] + B[1][3] * u[3]];
    out.push([z[0] + model.pbar[0], z[1] + model.pbar[1]]);
  }
  return out;
}

/**
 * Plan with the model: min || z[K] - z_target ||^2 + ridge ||u||^2  s.t. 0 <= u <= 1, by accelerated projected
 * gradient. K <= model.steps (the model only exists over the data's time span).
 */
export function planLTV(model, B, x0, target, K, { ridge = 1e-3, iters = 4000 } = {}) {
  if (K > model.steps) throw new Error(`horizon ${K} exceeds the model's ${model.steps} steps`);
  // Phi(K, j) = A[K-1] ... A[j]
  const Phi = new Array(K + 1);
  Phi[K] = [[1, 0], [0, 1]];
  for (let j = K - 1; j >= 0; j--) Phi[j] = matmul(Phi[j + 1], model.A[j]);
  const z0 = [x0[0] - model.pbar[0], x0[1] - model.pbar[1]], zt = [target[0] - model.pbar[0], target[1] - model.pbar[1]];
  const free = mul(Phi[0], z0), r = [zt[0] - free[0], zt[1] - free[1]];
  // M (2 x 4K): column (k, c) = Phi(K, k+1) B[:, c]
  const n = NU * K, M0 = new Float64Array(n), M1 = new Float64Array(n);
  for (let k = 0; k < K; k++) for (let c = 0; c < NU; c++) {
    const col = mul(Phi[k + 1], [B[0][c], B[1][c]]);
    M0[NU * k + c] = col[0]; M1[NU * k + c] = col[1];
  }
  // Lipschitz constant of the gradient of ||Mu - r||^2 + ridge ||u||^2: 2 (sigma_max(M)^2 + ridge)
  let g00 = 0, g01 = 0, g11 = 0, scale = 0;
  for (let i = 0; i < n; i++) { g00 += M0[i] * M0[i]; g01 += M0[i] * M1[i]; g11 += M1[i] * M1[i]; }
  const tr = g00 + g11, det = g00 * g11 - g01 * g01, smax = tr / 2 + Math.sqrt(Math.max(tr * tr / 4 - det, 0));
  const rho = ridge * (tr / n || 1);
  const L = 2 * (smax + rho), step = 1 / L;
  let u = new Float64Array(n), y = new Float64Array(n), tk = 1;
  for (let it = 0; it < iters; it++) {
    let e0 = -r[0], e1 = -r[1];
    for (let i = 0; i < n; i++) { e0 += M0[i] * y[i]; e1 += M1[i] * y[i]; }
    const un = new Float64Array(n);
    for (let i = 0; i < n; i++) un[i] = Math.min(Math.max(y[i] - step * 2 * (M0[i] * e0 + M1[i] * e1 + rho * y[i]), 0), 1);
    const tk1 = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2;
    for (let i = 0; i < n; i++) y[i] = un[i] + ((tk - 1) / tk1) * (un[i] - u[i]);
    u = un; tk = tk1;
    scale = it;
  }
  const path = rolloutLTV(model, B, x0, u, K);
  const end = path[K];
  return { U: u, path, plannedMiss: Math.hypot(end[0] - target[0], end[1] - target[1]), iterations: scale + 1 };
}
