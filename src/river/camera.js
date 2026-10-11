// Pan/zoom camera over the world (meters, y up). Everything is in layout pixels.
// Scripted moves (animateTo) and free user control (zoomAt / panBy) share one state.

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Camera {
  constructor(world) {
    this.world = world;
    this.cx = world.width / 2;
    this.cy = world.height / 2;
    this.zoom = 1; // px per meter
    this.w = 1;
    this.h = 1;
    this.anim = null;
    this.maxZoom = 14;
    this.minZoom = 0.2;
    this.changed = true;
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.minZoom = 0.85 * Math.min(w / this.world.width, h / this.world.height);
    this.zoom = Math.min(Math.max(this.zoom, this.minZoom), this.maxZoom);
    this.changed = true;
  }

  /** A view {cx, cy, span} (span = visible width in meters) as a concrete {cx, cy, zoom}. */
  resolve(view) {
    if (view.zoom) return { cx: view.cx, cy: view.cy, zoom: view.zoom };
    return { cx: view.cx, cy: view.cy, zoom: this.w / view.span };
  }

  /** Fit the whole domain with a margin. */
  homeView() {
    const { width, height } = this.world;
    return { cx: width / 2, cy: height / 2, zoom: 0.97 * Math.min(this.w / width, this.h / height) };
  }

  set(view) {
    const v = this.resolve(view);
    this.cx = v.cx; this.cy = v.cy; this.zoom = v.zoom;
    this.anim = null;
    this._clamp();
    this.changed = true;
  }

  animateTo(view, ms = 1800) {
    const to = this.resolve(view);
    this.anim = { from: { cx: this.cx, cy: this.cy, zoom: this.zoom }, to, ms, t0: null };
  }

  cancelAnimation() { this.anim = null; }
  get animating() { return !!this.anim; }

  /** Advance scripted animation; returns true if the view changed this frame. */
  update(nowMs) {
    let changed = this.changed;
    this.changed = false;
    const a = this.anim;
    if (a) {
      if (a.t0 == null) a.t0 = nowMs;
      const t = Math.min((nowMs - a.t0) / a.ms, 1), e = easeInOutCubic(t);
      const z0 = a.from.zoom, z1 = a.to.zoom;
      this.zoom = z0 * Math.pow(z1 / z0, e);
      // Interpolate the center so the pan looks uniform on screen even while zooming.
      const u = Math.abs(1 / z1 - 1 / z0) < 1e-12 ? e : (1 / this.zoom - 1 / z0) / (1 / z1 - 1 / z0);
      this.cx = a.from.cx + (a.to.cx - a.from.cx) * u;
      this.cy = a.from.cy + (a.to.cy - a.from.cy) * u;
      if (t >= 1) this.anim = null;
      changed = true;
    }
    return changed;
  }

  worldToScreen(x, y, out = [0, 0]) {
    out[0] = this.w / 2 + (x - this.cx) * this.zoom;
    out[1] = this.h / 2 - (y - this.cy) * this.zoom;
    return out;
  }

  screenToWorld(sx, sy, out = [0, 0]) {
    out[0] = this.cx + (sx - this.w / 2) / this.zoom;
    out[1] = this.cy - (sy - this.h / 2) / this.zoom;
    return out;
  }

  /** Visible world rectangle {x0, y0, x1, y1}. */
  bounds() {
    const hw = this.w / 2 / this.zoom, hh = this.h / 2 / this.zoom;
    return { x0: this.cx - hw, x1: this.cx + hw, y0: this.cy - hh, y1: this.cy + hh };
  }

  zoomAt(sx, sy, factor) {
    this.anim = null;
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(Math.max(this.zoom * factor, this.minZoom), this.maxZoom);
    const after = this.screenToWorld(sx, sy);
    this.cx += before[0] - after[0];
    this.cy += before[1] - after[1];
    this._clamp();
    this.changed = true;
  }

  panBy(dxPx, dyPx) {
    this.anim = null;
    this.cx -= dxPx / this.zoom;
    this.cy += dyPx / this.zoom;
    this._clamp();
    this.changed = true;
  }

  _clamp() {
    const { width, height } = this.world;
    const mx = width * 0.1, my = height * 0.1;
    this.cx = Math.min(Math.max(this.cx, -mx), width + mx);
    this.cy = Math.min(Math.max(this.cy, -my), height + my);
  }
}
