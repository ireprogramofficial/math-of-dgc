// A boat advanced step by step, for live (closed-loop or hand-steered) use.
// Unlike the optimizer's rollout it enforces the banks and the map edges as hard limits, so a person
// steering by hand cannot beach the boat or sail off the map.

export class LiveBoat {
  constructor(model) {
    this.model = model;
    this.x = new Float64Array(4);
    this._g = new Float64Array(3);
  }

  reset(start) {
    this.x.set(this.model.initialState(start));
    this.constrain();
  }

  /** Advance by h seconds with constant thrust u. */
  step(u, h) {
    this.model.step(this.x, u, h, this.x);
    this.constrain();
  }

  constrain() {
    const { flow } = this.model, x = this.x, g = this._g;
    const pad = 15;
    if (x[0] < pad) { x[0] = pad; if (x[2] < 0) x[2] = 0; }
    if (x[0] > flow.width - pad) { x[0] = flow.width - pad; if (x[2] > 0) x[2] = 0; }
    if (x[1] < pad) { x[1] = pad; if (x[3] < 0) x[3] = 0; }
    if (x[1] > flow.height - pad) { x[1] = flow.height - pad; if (x[3] > 0) x[3] = 0; }
    flow.insideAndGrad(x[0], x[1], g);
    if (g[0] < 3) {
      const m = Math.hypot(g[1], g[2]) || 1, nx = g[1] / m, ny = g[2] / m;
      x[0] += (3 - g[0]) * nx; x[1] += (3 - g[0]) * ny;
      const vn = x[2] * nx + x[3] * ny;
      if (vn < 0) { x[2] -= vn * nx; x[3] -= vn * ny; }
    }
  }
}
