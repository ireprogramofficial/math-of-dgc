// A flow field sampled on a regular grid. Grid row j=0 is world y=0 (y up), cell centers at (i+.5)*cell.
// Besides velocity (u, v) in m/s it stores `inside`: signed distance to the nearest bank in meters,
// positive in water and negative on land. That makes shorelines crisp at any zoom, and gives the
// optimizer a differentiable "stay in the water" penalty.

export class FlowField {
  constructor({ nx, ny, cell, width, height, u, v, inside, speedRef }) {
    Object.assign(this, { nx, ny, cell, width, height, u, v, inside, speedRef });
  }

  _locate(x, y) {
    const { nx, ny, cell } = this;
    let fx = x / cell - 0.5, fy = y / cell - 0.5;
    fx = fx < 0 ? 0 : fx > nx - 1 ? nx - 1 : fx;
    fy = fy < 0 ? 0 : fy > ny - 1 ? ny - 1 : fy;
    let i = Math.floor(fx), j = Math.floor(fy);
    if (i > nx - 2) i = nx - 2;
    if (j > ny - 2) j = ny - 2;
    this._i = i; this._j = j; this._tx = fx - i; this._ty = fy - j;
  }

  _bilerp(arr) {
    const { nx, _i: i, _j: j, _tx: tx, _ty: ty } = this;
    const k = j * nx + i;
    const a = arr[k], b = arr[k + 1], c = arr[k + nx], d = arr[k + nx + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /** Water velocity at (x, y); writes [u, v] into `out`. */
  velocity(x, y, out = [0, 0]) {
    this._locate(x, y);
    out[0] = this._bilerp(this.u);
    out[1] = this._bilerp(this.v);
    return out;
  }

  /** Velocity and its Jacobian: out = [u, v, du/dx, du/dy, dv/dx, dv/dy]. */
  velocityAndJacobian(x, y, out = new Float64Array(6)) {
    this._locate(x, y);
    const { nx, cell, _i: i, _j: j, _tx: tx, _ty: ty } = this;
    const k = j * nx + i;
    for (let q = 0; q < 2; q++) {
      const arr = q === 0 ? this.u : this.v;
      const a = arr[k], b = arr[k + 1], c = arr[k + nx], d = arr[k + nx + 1];
      out[q] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      out[2 + 2 * q] = ((b - a) * (1 - ty) + (d - c) * ty) / cell;
      out[3 + 2 * q] = ((c * (1 - tx) + d * tx) - (a * (1 - tx) + b * tx)) / cell;
    }
    return out;
  }

  /** Signed distance to the bank (positive in water). */
  insideAt(x, y) {
    this._locate(x, y);
    return this._bilerp(this.inside);
  }

  /** Signed bank distance and its gradient: out = [inside, d/dx, d/dy]. */
  insideAndGrad(x, y, out = new Float64Array(3)) {
    this._locate(x, y);
    const { nx, cell, _i: i, _j: j, _tx: tx, _ty: ty } = this;
    const k = j * nx + i, s = this.inside;
    const a = s[k], b = s[k + 1], c = s[k + nx], d = s[k + nx + 1];
    out[0] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    out[1] = ((b - a) * (1 - ty) + (d - c) * ty) / cell;
    out[2] = ((c * (1 - tx) + d * tx) - (a * (1 - tx) + b * tx)) / cell;
    return out;
  }

  isWater(x, y, margin = 0) {
    return x >= 0 && y >= 0 && x <= this.width && y <= this.height && this.insideAt(x, y) > margin;
  }

  speedAt(x, y) {
    const v = this.velocity(x, y, this._tmp || (this._tmp = [0, 0]));
    return Math.hypot(v[0], v[1]);
  }

  /** Pack as RGBA float for the GPU: r=u, g=v, b=inside (m), a=1. */
  toRGBA() {
    const n = this.nx * this.ny, out = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      out[4 * k] = this.u[k]; out[4 * k + 1] = this.v[k]; out[4 * k + 2] = this.inside[k]; out[4 * k + 3] = 1;
    }
    return out;
  }
}
