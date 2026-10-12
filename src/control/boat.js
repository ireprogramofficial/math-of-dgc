// The running example: a boat on a river.
//
//   state    x = (px, py)                    position (m)
//   input    u = (uN, uE, uS, uW) in [0,1]^4   four thrusters, each pushing in one cardinal direction
//   dynamics x' = f(x) + G u                 (control-affine, first order)
//     f(x) = w(x)                            drift: the boat moves with the local water velocity
//     G    = s E,  E = [[0,1,0,-1],[1,0,-1,0]]   constant input matrix: full thrust adds s m/s through the water
//
// The boat has no inertia: its velocity is x' = w(x) + G u, the water's velocity plus the thrust's. (This is the
// limit of a boat with drag whose speed settles in a few seconds, short next to trips of several minutes.)
//
// The open-loop schedule is piecewise constant: U[k] = u on the k-th of N equal intervals over horizon T.
// Each interval is integrated with `sub` RK4 sub-steps. Along the way we can also carry the sensitivities
//   A_j = d x_{j+1} / d x_j  (2x2),   B_j = d x_{j+1} / d u  (2x4)      (one pair per sub-step)
// i.e. the discrete-time linear time-varying system  dx_{j+1} = A_j dx_j + B_j du  linearized about the trajectory.

export const DIRS = ['N', 'E', 'S', 'W'];
export const NU = 4; // inputs
export const NX = 2; // states

export class BoatModel {
  constructor(flow, { speed = 3 } = {}) {
    this.flow = flow;
    this.speed = speed; // m/s added by one thruster at full power
    this._w = [0, 0];
    this._J = new Float64Array(6);
    // scratch
    this._k = Array.from({ length: 4 }, () => new Float64Array(NX));
    this._tmp = new Float64Array(NX);
    this._ys = Array.from({ length: 4 }, () => new Float64Array(14));
    this._yt = new Float64Array(14);
    this._y = new Float64Array(14);
  }

  /** The input's velocity G u = (vx, vy) for input u. */
  thrustVelocity(u, out = [0, 0]) {
    out[0] = this.speed * (u[1] - u[3]);
    out[1] = this.speed * (u[0] - u[2]);
    return out;
  }

  /** Time derivative of the state: x' = w(x) + G u. */
  deriv(x, u, dx) {
    const w = this.flow.velocity(x[0], x[1], this._w), s = this.speed;
    dx[0] = w[0] + s * (u[1] - u[3]);
    dx[1] = w[1] + s * (u[0] - u[2]);
  }

  /** Derivative of the augmented state y = [x(2), A(4), B(8)] (A 2x2, B 2x4, row-major): A' = J A, B' = J B + G. */
  derivSens(y, u, dy) {
    const s = this.speed;
    const J = this.flow.velocityAndJacobian(y[0], y[1], this._J);
    const wxx = J[2], wxy = J[3], wyx = J[4], wyy = J[5];
    dy[0] = J[0] + s * (u[1] - u[3]);
    dy[1] = J[1] + s * (u[0] - u[2]);
    for (let col = 0; col < 2; col++) { // A at 2..5
      const r0 = y[2 + col], r1 = y[4 + col];
      dy[2 + col] = wxx * r0 + wxy * r1;
      dy[4 + col] = wyx * r0 + wyy * r1;
    }
    for (let col = 0; col < 4; col++) { // B at 6..13
      const r0 = y[6 + col], r1 = y[10 + col];
      dy[6 + col] = wxx * r0 + wxy * r1;
      dy[10 + col] = wyx * r0 + wyy * r1;
    }
    dy[6 + 1] += s; dy[6 + 3] -= s;   // row 0 (x): +E, -W
    dy[10 + 0] += s; dy[10 + 2] -= s; // row 1 (y): +N, -S
  }

  /** One RK4 step of the state only. Writes into `out` (may alias x). */
  step(x, u, h, out) {
    const [k1, k2, k3, k4] = this._k, t = this._tmp;
    this.deriv(x, u, k1);
    for (let i = 0; i < NX; i++) t[i] = x[i] + 0.5 * h * k1[i];
    this.deriv(t, u, k2);
    for (let i = 0; i < NX; i++) t[i] = x[i] + 0.5 * h * k2[i];
    this.deriv(t, u, k3);
    for (let i = 0; i < NX; i++) t[i] = x[i] + h * k3[i];
    this.deriv(t, u, k4);
    for (let i = 0; i < NX; i++) out[i] = x[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }

  /** One RK4 step of state + sensitivities. Writes xOut(2), A(4), B(8). */
  stepSens(x, u, h, xOut, A, B) {
    const y = this._y, yt = this._yt, [k1, k2, k3, k4] = this._ys, n = y.length;
    y.fill(0);
    y[0] = x[0]; y[1] = x[1]; y[2] = 1; y[5] = 1;
    this.derivSens(y, u, k1);
    for (let i = 0; i < n; i++) yt[i] = y[i] + 0.5 * h * k1[i];
    this.derivSens(yt, u, k2);
    for (let i = 0; i < n; i++) yt[i] = y[i] + 0.5 * h * k2[i];
    this.derivSens(yt, u, k3);
    for (let i = 0; i < n; i++) yt[i] = y[i] + h * k3[i];
    this.derivSens(yt, u, k4);
    for (let i = 0; i < n; i++) y[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    xOut[0] = y[0]; xOut[1] = y[1];
    for (let i = 0; i < 4; i++) A[i] = y[2 + i];
    for (let i = 0; i < 8; i++) B[i] = y[6 + i];
  }

  /**
   * Simulate the schedule U (N x 4, row-major) over horizon T.
   * @returns {{X: Float64Array, A?: Float64Array, B?: Float64Array, M: number, h: number}}
   *   X holds M+1 states (2 each). With `sens`, A holds one 2x2 and B one 2x4 per sub-step.
   */
  rollout(x0, U, { N, sub, T }, sens = false) {
    const M = N * sub, h = T / M;
    const X = new Float64Array((M + 1) * NX);
    const A = sens ? new Float64Array(M * 4) : null, B = sens ? new Float64Array(M * 8) : null;
    X[0] = x0[0]; X[1] = x0[1];
    const cur = Float64Array.of(x0[0], x0[1]), nxt = new Float64Array(NX), u = new Float64Array(NU);
    for (let j = 0; j < M; j++) {
      const k = Math.floor(j / sub);
      for (let c = 0; c < NU; c++) u[c] = U[NU * k + c];
      if (sens) this.stepSens(cur, u, h, nxt, A.subarray(4 * j, 4 * j + 4), B.subarray(8 * j, 8 * j + 8));
      else this.step(cur, u, h, nxt);
      cur.set(nxt);
      X.set(nxt, NX * (j + 1));
    }
    return { X, A, B, M, h };
  }

  /** Initial condition: the start position. */
  initialState(start) {
    return Float64Array.of(start[0], start[1]);
  }
}
