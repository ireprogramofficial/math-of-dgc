// The running example: a boat on a river.
//
//   state    x = (px, py, vx, vy)        position (m) and velocity (m/s)
//   input    u = (uN, uE, uS, uW) in [0,1]^4   four thrusters, each pushing in one cardinal direction
//   dynamics x' = f(x) + G u            (control-affine)
//     f(x) = ( v ,  -c (v - w(p)) )     drift: the boat is dragged toward the local water velocity w(p)
//     G    = [ 0 ; a E ],  E = [[0,1,0,-1],[1,0,-1,0]]   constant control matrix (thrust accelerates the boat)
//
// The open-loop schedule is piecewise constant: U[k] = u on the k-th of N equal intervals over horizon T.
// Each interval is integrated with `sub` RK4 sub-steps. Along the way we can also carry the sensitivities
//   A_j = d x_{j+1} / d x_j ,   B_j = d x_{j+1} / d u      (one pair per sub-step)
// i.e. the discrete-time linear time-varying system  dx_{j+1} = A_j dx_j + B_j du  linearized about the trajectory.

export const DIRS = ['N', 'E', 'S', 'W'];
export const NU = 4;

export class BoatModel {
  constructor(flow, { drag = 0.25, accel = 0.75 } = {}) {
    this.flow = flow;
    this.c = drag;
    this.a = accel;
    this._w = [0, 0];
    this._J = new Float64Array(6);
    // scratch
    this._k = Array.from({ length: 4 }, () => new Float64Array(4));
    this._tmp = new Float64Array(4);
    this._ys = Array.from({ length: 4 }, () => new Float64Array(36));
    this._yt = new Float64Array(36);
    this._y = new Float64Array(36);
  }

  /** Thrust acceleration (ax, ay) for input u. */
  thrustAccel(u, out = [0, 0]) {
    out[0] = this.a * (u[1] - u[3]);
    out[1] = this.a * (u[0] - u[2]);
    return out;
  }

  /** Time derivative of the state. */
  deriv(x, u, dx) {
    const w = this.flow.velocity(x[0], x[1], this._w), { c, a } = this;
    dx[0] = x[2];
    dx[1] = x[3];
    dx[2] = -c * (x[2] - w[0]) + a * (u[1] - u[3]);
    dx[3] = -c * (x[3] - w[1]) + a * (u[0] - u[2]);
  }

  /** Derivative of the augmented state y = [x(4), A(16), B(16)] (A, B row-major 4x4). */
  derivSens(y, u, dy) {
    const { c, a } = this;
    const J = this.flow.velocityAndJacobian(y[0], y[1], this._J);
    const w0 = J[0], w1 = J[1], wxx = J[2], wxy = J[3], wyx = J[4], wyy = J[5];
    dy[0] = y[2];
    dy[1] = y[3];
    dy[2] = -c * (y[2] - w0) + a * (u[1] - u[3]);
    dy[3] = -c * (y[3] - w1) + a * (u[0] - u[2]);
    for (let m = 0; m < 2; m++) {
      const o = 4 + 16 * m; // A at 4, B at 20
      for (let col = 0; col < 4; col++) {
        const r0 = y[o + col], r1 = y[o + 4 + col], r2 = y[o + 8 + col], r3 = y[o + 12 + col];
        dy[o + col] = r2;
        dy[o + 4 + col] = r3;
        dy[o + 8 + col] = c * (wxx * r0 + wxy * r1) - c * r2;
        dy[o + 12 + col] = c * (wyx * r0 + wyy * r1) - c * r3;
      }
    }
    // dB/dt += G
    dy[20 + 8 + 1] += a; dy[20 + 8 + 3] -= a;   // row 2 (ax): +E, -W
    dy[20 + 12 + 0] += a; dy[20 + 12 + 2] -= a; // row 3 (ay): +N, -S
  }

  /** One RK4 step of the state only. Writes into `out` (may alias x). */
  step(x, u, h, out) {
    const [k1, k2, k3, k4] = this._k, t = this._tmp;
    this.deriv(x, u, k1);
    for (let i = 0; i < 4; i++) t[i] = x[i] + 0.5 * h * k1[i];
    this.deriv(t, u, k2);
    for (let i = 0; i < 4; i++) t[i] = x[i] + 0.5 * h * k2[i];
    this.deriv(t, u, k3);
    for (let i = 0; i < 4; i++) t[i] = x[i] + h * k3[i];
    this.deriv(t, u, k4);
    for (let i = 0; i < 4; i++) out[i] = x[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }

  /** One RK4 step of state + sensitivities. Writes xOut(4), A(16), B(16). */
  stepSens(x, u, h, xOut, A, B) {
    const y = this._y, yt = this._yt, [k1, k2, k3, k4] = this._ys;
    y.fill(0);
    for (let i = 0; i < 4; i++) { y[i] = x[i]; y[4 + 5 * i] = 1; }
    this.derivSens(y, u, k1);
    for (let i = 0; i < 36; i++) yt[i] = y[i] + 0.5 * h * k1[i];
    this.derivSens(yt, u, k2);
    for (let i = 0; i < 36; i++) yt[i] = y[i] + 0.5 * h * k2[i];
    this.derivSens(yt, u, k3);
    for (let i = 0; i < 36; i++) yt[i] = y[i] + h * k3[i];
    this.derivSens(yt, u, k4);
    for (let i = 0; i < 36; i++) y[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    for (let i = 0; i < 4; i++) xOut[i] = y[i];
    for (let i = 0; i < 16; i++) { A[i] = y[4 + i]; B[i] = y[20 + i]; }
  }

  /**
   * Simulate the schedule U (N x 4, row-major) over horizon T.
   * @returns {{X: Float64Array, A?: Float64Array, B?: Float64Array, M: number, h: number}}
   *   X holds M+1 states (4 each). With `sens`, A and B hold one 4x4 per sub-step.
   */
  rollout(x0, U, { N, sub, T }, sens = false) {
    const M = N * sub, h = T / M;
    const X = new Float64Array((M + 1) * 4);
    const A = sens ? new Float64Array(M * 16) : null, B = sens ? new Float64Array(M * 16) : null;
    X.set(x0, 0);
    const cur = new Float64Array(4), nxt = new Float64Array(4), u = new Float64Array(4);
    cur.set(x0);
    for (let j = 0; j < M; j++) {
      const k = Math.floor(j / sub);
      for (let c = 0; c < 4; c++) u[c] = U[4 * k + c];
      if (sens) this.stepSens(cur, u, h, nxt, A.subarray(16 * j, 16 * j + 16), B.subarray(16 * j, 16 * j + 16));
      else this.step(cur, u, h, nxt);
      cur.set(nxt);
      X.set(nxt, 4 * (j + 1));
    }
    return { X, A, B, M, h };
  }

  /** Initial condition: at rest relative to the water. */
  initialState(start) {
    const w = this.flow.velocity(start[0], start[1], [0, 0]);
    return Float64Array.of(start[0], start[1], w[0], w[1]);
  }
}
