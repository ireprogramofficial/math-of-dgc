// A boat advanced step by step, for live (closed-loop or hand-steered) use.
// Unlike the optimizer's rollout it enforces the banks and the map edges as hard limits, so a person
// steering by hand cannot beach the boat or sail off the map.
// The state is the position x = (px, py); `v` is the velocity over the last step (for drawing the heading).

export class LiveBoat {
  constructor(model) {
    this.model = model;
    this.x = new Float64Array(2);
    this.v = new Float64Array(2);
    this._g = new Float64Array(3);
  }

  reset(start) {
    this.x.set(this.model.initialState(start));
    this.v.fill(0);
    this.constrain();
  }

  /** Advance by h seconds with constant thrust u. */
  step(u, h) {
    const x0 = this.x[0], y0 = this.x[1];
    this.model.step(this.x, u, h, this.x);
    this.constrain();
    if (h > 0) { this.v[0] = (this.x[0] - x0) / h; this.v[1] = (this.x[1] - y0) / h; }
  }

  /** Displace the boat by (dx, dy), e.g. a gust, keeping it in the water. */
  push(dx, dy) { this.x[0] += dx; this.x[1] += dy; this.constrain(); }

  constrain() {
    const { flow } = this.model, x = this.x, g = this._g;
    const pad = 15;
    x[0] = Math.min(Math.max(x[0], pad), flow.width - pad);
    x[1] = Math.min(Math.max(x[1], pad), flow.height - pad);
    flow.insideAndGrad(x[0], x[1], g);
    if (g[0] < 3) {
      const m = Math.hypot(g[1], g[2]) || 1;
      x[0] += ((3 - g[0]) * g[1]) / m; x[1] += ((3 - g[0]) * g[2]) / m;
    }
  }
}
