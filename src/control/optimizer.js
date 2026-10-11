// Open-loop deterministic trajectory optimization for the boat.
//
//   minimize over U in [0, umax]^(N x 4), with disabled thrusters pinned to 0:
//     J(U) = 1/2 (x_M - x*)' Q (x_M - x*)                       terminal miss (position, and a little velocity)
//          + sum_k dt ( rho/2 |u_k|^2 + rho1 * 1'u_k )           effort (quadratic + fuel-like linear)
//          + sum_j h  kappa/2 max(0, margin - inside(p_j))^2     stay in the water (soft bank penalty)
//     subject to x_{j+1} = Phi(x_j, u_k)   (RK4 of x' = f(x) + G u)
//
// The gradient is exact for the discrete problem: roll out with sensitivities (A_j, B_j), then run the adjoint
//   lambda_M = dJ/dx_M,   lambda_j = A_j' lambda_{j+1} + h dl/dx_j,   dJ/du_k += sum_{j in k} B_j' lambda_{j+1}.
// The solver is accelerated projected gradient (FISTA) with backtracking and adaptive restart: simple, convex-style
// machinery that is reliable for box constraints, and cheap enough to animate in the browser.

import { NU } from './boat.js';

export const DEFAULT_WEIGHTS = {
  qPos: 1,         // 1/m^2-scaled terminal position weight
  qVel: 0.05,      // terminal velocity weight
  rho: 20,         // quadratic effort
  rho1: 0,         // linear (fuel-like) effort
  kappa: 0.5,      // land penalty strength
  margin: 8,       // meters of clearance wanted from the bank
};

export function makeProblem(model, scenario, overrides = {}) {
  const { start, target, horizon } = scenario.boat;
  return {
    model,
    x0: model.initialState(start),
    target: Float64Array.of(target[0], target[1], 0, 0),
    N: overrides.N ?? 60,
    sub: overrides.sub ?? 5,
    T: overrides.T ?? horizon,
    enabled: overrides.enabled ?? [true, true, true, true],
    umax: 1,
    weights: { ...DEFAULT_WEIGHTS, ...(overrides.weights ?? {}) },
  };
}

export function project(U, problem) {
  const { enabled, umax } = problem;
  for (let i = 0; i < U.length; i++) {
    const c = i % NU;
    U[i] = enabled[c] ? Math.min(Math.max(U[i], 0), umax) : 0;
  }
  return U;
}

/** Cost (and optionally gradient) of a schedule. */
export function evaluate(problem, U, wantGrad = false) {
  const { model, x0, target, N, sub, T, weights: w } = problem;
  const { X, A, B, M, h } = model.rollout(x0, U, { N, sub, T }, wantGrad);
  const flow = model.flow, dtU = T / N;
  const Q = [w.qPos, w.qPos, w.qVel, w.qVel];

  const e = new Float64Array(4);
  let terminal = 0;
  for (let i = 0; i < 4; i++) { e[i] = X[4 * M + i] - target[i]; terminal += 0.5 * Q[i] * e[i] * e[i]; }

  let effort = 0;
  for (let k = 0; k < N; k++) {
    let sq = 0, sum = 0;
    for (let c = 0; c < NU; c++) { const u = U[4 * k + c]; sq += u * u; sum += u; }
    effort += dtU * (0.5 * w.rho * sq + w.rho1 * sum);
  }

  // land penalty at every sub-step node
  const g3 = new Float64Array(3);
  let land = 0;
  const landGrad = wantGrad ? new Float64Array((M + 1) * 2) : null;
  for (let j = 1; j <= M; j++) {
    flow.insideAndGrad(X[4 * j], X[4 * j + 1], g3);
    const pen = Math.max(0, w.margin - g3[0]);
    if (pen > 0) {
      land += 0.5 * w.kappa * pen * pen * h;
      if (wantGrad) { landGrad[2 * j] = -w.kappa * pen * g3[1] * h; landGrad[2 * j + 1] = -w.kappa * pen * g3[2] * h; }
    }
  }

  const J = terminal + effort + land;
  const out = { J, terminal, effort, land, X, M, h, miss: Math.hypot(e[0], e[1]), grad: null };
  if (!wantGrad) return out;

  const grad = new Float64Array(N * NU);
  const lam = new Float64Array(4), nl = new Float64Array(4);
  for (let i = 0; i < 4; i++) lam[i] = Q[i] * e[i];
  lam[0] += landGrad[2 * M]; lam[1] += landGrad[2 * M + 1];
  for (let j = M - 1; j >= 0; j--) {
    const k = Math.floor(j / sub), b = 16 * j;
    for (let c = 0; c < NU; c++) {
      let s = 0;
      for (let r = 0; r < 4; r++) s += B[b + 4 * r + c] * lam[r];
      grad[4 * k + c] += s;
    }
    if (j === 0) break;
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let r = 0; r < 4; r++) s += A[b + 4 * r + c] * lam[r];
      nl[c] = s;
    }
    nl[0] += landGrad[2 * j]; nl[1] += landGrad[2 * j + 1];
    lam.set(nl);
  }
  for (let k = 0; k < N; k++) for (let c = 0; c < NU; c++) grad[4 * k + c] += dtU * (w.rho * U[4 * k + c] + w.rho1);
  out.grad = grad;
  return out;
}

export class TrajectoryOptimizer {
  constructor(problem, U0 = null) {
    this.problem = problem;
    const n = problem.N * NU;
    this.U = project(U0 ? Float64Array.from(U0) : new Float64Array(n), problem);
    this.Y = Float64Array.from(this.U);
    this.t = 1e-2;     // step size, adapted by backtracking
    this.tk = 1;
    this.iter = 0;
    this.history = [];
    this.done = false;
    this.last = evaluate(problem, this.U, false);
    this.gmap = Infinity;
  }

  get cost() { return this.last.J; }

  /** Run `n` iterations (stops early at convergence). Returns the current evaluation of U. */
  run(n) {
    for (let i = 0; i < n && !this.done; i++) this._iterate();
    return this.last;
  }

  _iterate() {
    const { problem } = this, n = this.U.length;
    const fy = evaluate(problem, this.Y, true), g = fy.grad;
    let t = this.t * 1.5, Unew = new Float64Array(n), fNew;
    for (let bt = 0; bt < 40; bt++) {
      let dg = 0, dd = 0;
      for (let i = 0; i < n; i++) Unew[i] = this.Y[i] - t * g[i];
      project(Unew, problem);
      for (let i = 0; i < n; i++) { const d = Unew[i] - this.Y[i]; dg += g[i] * d; dd += d * d; }
      fNew = evaluate(problem, Unew, false);
      if (fNew.J <= fy.J + dg + dd / (2 * t) + 1e-9 * Math.abs(fy.J)) break;
      t *= 0.5;
    }
    this.t = t;

    // gradient-mapping norm: how far a projected gradient step would still move
    let gm = 0;
    for (let i = 0; i < n; i++) { const d = (this.Y[i] - Unew[i]) / t; gm += d * d; }
    this.gmap = Math.sqrt(gm);

    // momentum with function-value restart
    const restart = fNew.J > this.last.J;
    const tk1 = (1 + Math.sqrt(1 + 4 * this.tk * this.tk)) / 2;
    const beta = restart ? 0 : (this.tk - 1) / tk1;
    for (let i = 0; i < n; i++) this.Y[i] = Unew[i] + beta * (Unew[i] - this.U[i]);
    this.tk = restart ? 1 : tk1;
    if (restart) this.Y.set(Unew);

    const improvement = this.last.J - fNew.J;
    this.U = Unew;
    this.last = fNew;
    this.iter++;
    this.history.push(fNew.J);
    const k = this.history.length;
    const stalled = k > 30 && Math.abs(this.history[k - 30] - fNew.J) < 1e-7 * Math.max(1, Math.abs(fNew.J));
    if (this.gmap < 1e-6 || stalled || (improvement >= 0 && improvement < 1e-12 && this.iter > 5)) this.done = true;
  }
}
