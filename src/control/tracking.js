// Closed-loop tracking of an open-loop plan (the closed-loop boat on the closed- vs open-loop slide).
//
//   G u = G u_plan(t) + k (x_plan(t) - x),   then u = thruster fractions, clipped to [0, 1]
//
// With no disturbance x = x_plan(t), the correction is zero, and the boat follows the plan exactly. After a push
// it is steered back onto the plan. Both are defined on the plan's horizon [0, T] only (sub-steps j < M).
import { NU, NX } from './boat.js';

/** Thruster fractions u (N, E, S, W) that produce the velocity (gx, gy) = G u, each clipped to [0, 1]. */
export function thrustFor(model, gx, gy, out = new Float64Array(NU)) {
  const ux = Math.min(Math.max(gx / model.speed, -1), 1), uy = Math.min(Math.max(gy / model.speed, -1), 1);
  out[0] = Math.max(uy, 0); out[2] = Math.max(-uy, 0);
  out[1] = Math.max(ux, 0); out[3] = Math.max(-ux, 0);
  return out;
}

/**
 * The open-loop schedule u_plan(j) and the closed-loop tracker, both indexed by sub-step j = t / h of the plan.
 * @param U plan (N x 4), X its rollout (M + 1 states)
 */
export function makeLoops(model, problem, U, X, { gain = 0.08 } = {}) {
  const { N, sub } = problem, M = N * sub, s = model.speed;
  const uPlan = (j, out = new Float64Array(NU)) => {
    const k = Math.min(Math.floor(j / sub), N - 1);
    for (let c = 0; c < NU; c++) out[c] = U[NU * k + c];
    return out;
  };
  const tmp = new Float64Array(NU), u = new Float64Array(NU);
  const track = (j, x) => {
    uPlan(j, tmp);
    const gx = s * (tmp[1] - tmp[3]) + gain * (X[NX * j] - x[0]);
    const gy = s * (tmp[0] - tmp[2]) + gain * (X[NX * j + 1] - x[1]);
    return thrustFor(model, gx, gy, u);
  };
  return { uPlan, track, M };
}
