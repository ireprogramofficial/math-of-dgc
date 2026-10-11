// CPU particle system for the flow streaks.
//
// Design goal: the picture stays readable at any zoom. So particle density and on-screen speed are defined in
// *screen* space, not world space: roughly the same number of streaks per water pixel, moving at roughly the same
// pixels/second, whether you look at 1.6 km of river or 100 m of it. Particles only record their head position; the
// GPU reconstructs each streak's curved tail by integrating the flow backward (see renderer.js).

export class ParticleSystem {
  /**
   * @param {FlowField} flow
   * @param {object} opts density: streaks per water pixel; pxPerSec: on-screen speed of the fastest water;
   *                      maxParticles: pool size; life: [min, max] seconds
   */
  constructor(flow, { density = 0.0055, pxPerSec = 80, maxParticles = 24000, life = [2.2, 5.0] } = {}) {
    this.flow = flow;
    this.density = density;
    this.pxPerSec = pxPerSec;
    this.max = maxParticles;
    this.life = life;
    this.data = new Float32Array(maxParticles * 3); // x, y, phase (0..1 of its life)
    this.rate = new Float32Array(maxParticles);     // phase per second
    this.count = 0;
    this._v = [0, 0];
    this._lastZoom = null;
    this._lastBounds = null;
    this._waterFrac = 0.3;
    this._fracTimer = 0;
  }

  setFlow(flow) {
    this.flow = flow;
    this.count = 0;
    this._lastZoom = null;
  }

  _spawn(i, b, speedRef, randomPhase) {
    const f = this.flow, d = this.data;
    let x = 0, y = 0;
    for (let tries = 0; tries < 24; tries++) {
      x = b.x0 + Math.random() * (b.x1 - b.x0);
      y = b.y0 + Math.random() * (b.y1 - b.y0);
      if (!f.isWater(x, y, 2)) continue;
      // Favor fast water a bit, so rivers read as denser than slow lakes, as in the reference.
      const w = 0.3 + 0.7 * Math.min(f.speedAt(x, y) / speedRef, 1);
      if (Math.random() < w) break;
    }
    d[3 * i] = x; d[3 * i + 1] = y;
    d[3 * i + 2] = randomPhase ? Math.random() : 0;
    this.rate[i] = 1 / (this.life[0] + Math.random() * (this.life[1] - this.life[0]));
  }

  _estimateWaterFraction(b) {
    const f = this.flow;
    let hit = 0, n = 0;
    const x0 = Math.max(b.x0, 0), x1 = Math.min(b.x1, f.width), y0 = Math.max(b.y0, 0), y1 = Math.min(b.y1, f.height);
    if (x1 <= x0 || y1 <= y0) return 0.01;
    for (let k = 0; k < 600; k++) {
      n++;
      if (f.isWater(x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0), 1)) hit++;
    }
    // fraction of the *screen* that is water
    const vis = ((x1 - x0) * (y1 - y0)) / ((b.x1 - b.x0) * (b.y1 - b.y0));
    return Math.max((hit / n) * vis, 0.005);
  }

  /**
   * Advance by dt seconds for the camera's current view. `viewPx` is the screen area in layout px^2.
   */
  update(dt, camera) {
    dt = Math.min(dt, 0.05);
    const b = camera.bounds();
    const f = this.flow, d = this.data, v = this._v;
    const speedRef = f.speedRef;

    // Re-estimate how much of the screen is water a few times per second (and right after view jumps).
    this._fracTimer -= dt;
    const viewMoved = this._lastZoom == null || Math.abs(Math.log(camera.zoom / this._lastZoom)) > 0.05;
    if (this._fracTimer <= 0 || viewMoved) {
      this._waterFrac = this._estimateWaterFraction(b);
      this._fracTimer = 0.25;
    }
    const target = Math.round(Math.min(Math.max(this.density * camera.w * camera.h * this._waterFrac, 150), this.max));
    // Grow smoothly; shrink immediately.
    if (target > this.count) {
      const grow = Math.min(target, this.count + Math.max(200, Math.round(this.count * 0.2)));
      for (let i = this.count; i < grow; i++) this._spawn(i, b, speedRef, true);
      this.count = grow;
    } else this.count = target;

    // Zooming out reveals empty water; spread some particles into the new area.
    let respawnProb = 0;
    if (this._lastZoom != null) respawnProb = Math.min(0.5, 3 * Math.abs(Math.log(camera.zoom / this._lastZoom)));
    this._lastZoom = camera.zoom;

    const pad = 0.04 * (b.x1 - b.x0);
    for (let i = 0; i < this.count; i++) {
      let x = d[3 * i], y = d[3 * i + 1], ph = d[3 * i + 2] + this.rate[i] * dt;
      let dead = ph >= 1 || x < b.x0 - pad || x > b.x1 + pad || y < b.y0 - pad || y > b.y1 + pad || (respawnProb > 0 && Math.random() < respawnProb);
      if (!dead) {
        f.velocity(x, y, v);
        const sp = Math.hypot(v[0], v[1]);
        if (f.insideAt(x, y) < 1.5) dead = true;
        else if (sp > 1e-4) {
          // constant on-screen speed (scaled by relative water speed), independent of zoom
          const k = (this.pxPerSec * (0.2 + 0.8 * Math.min(sp / speedRef, 1))) / camera.zoom;
          x += (v[0] / sp) * k * dt; y += (v[1] / sp) * k * dt;
          d[3 * i] = x; d[3 * i + 1] = y; d[3 * i + 2] = ph;
        } else d[3 * i + 2] = ph;
      }
      if (dead) this._spawn(i, b, speedRef, false);
    }
    return this.count;
  }
}
