// SteerScene: a boat driven by an open-loop autopilot, a fixed schedule u(t) that cycles the thrust through
// N, NE, E, ..., NW at full power, DIR_SECONDS each, whatever the boat's state. A person can take over with the
// thrusters; after MANUAL_HOLD_MS without input the schedule resumes. When the current carries the boat to the
// river's outlet it starts again from the start.
// Deliberately shows no target: just the boat, the drift f(x) and the input G(x)u.

import { BoatModel, NU } from '../control/boat.js';
import { LiveBoat } from '../control/liveBoat.js';
import { RiverView } from '../river/view.js';
import { arrow, boatGlyph, COLORS } from './draw.js';

export const MANUAL_HOLD_MS = 7000;
const TIME_SCALE = 40;     // sim seconds per real second: a river crossing takes ~10 s
const MAX_STEP = 0.4;      // sim seconds per integration step
const TAP_MS = 220;        // a tap (down+up within one frame) still delivers this much thrust
const KEYS = { w: 0, d: 1, s: 2, a: 3 }; // N, E, S, W
const DIR_SECONDS = 2;     // real seconds per direction of the open-loop schedule
// the schedule's directions: thruster settings (N, E, S, W), every thruster pointing that way at full power
export const SCHEDULE = [
  ['N', [1, 0, 0, 0]], ['NE', [1, 1, 0, 0]], ['E', [0, 1, 0, 0]], ['SE', [0, 1, 1, 0]],
  ['S', [0, 0, 1, 0]], ['SW', [0, 0, 1, 1]], ['W', [0, 0, 0, 1]], ['NW', [1, 0, 0, 1]],
];

export class SteerScene {
  constructor(stageEl, { scenario = 'meander', onStatus } = {}) {
    this.onStatus = onStatus;
    this.view = new RiverView(stageEl, { scenario });
    this.view.onDraw = (ctx, v, now, dt) => this._frame(ctx, dt);
    this.view.onFlow = (flow, scn) => this._onFlow(flow, scn);
    this.held = new Set();          // thrusters currently held (0..3), from keys or the on-screen pad
    this.tapUntil = new Float64Array(NU); // time until which a briefly tapped thruster stays on
    this.manualUntil = 0;
    this.mode = 'auto';
    this.u = new Float64Array(NU);
    this.wake = [];
    this._keydown = (e) => this._key(e, true);
    this._keyup = (e) => this._key(e, false);
    this._blur = () => this.held.clear();
  }

  get scenario() { return this.view.scenario; }

  setActive(on) {
    this.view.setActive(on);
    const fn = on ? 'addEventListener' : 'removeEventListener';
    document[fn]('keydown', this._keydown);
    document[fn]('keyup', this._keyup);
    window[fn]('blur', this._blur);
    if (!on) this.held.clear();
  }

  destroy() { this.setActive(false); this.view.destroy(); }

  async setScenario(id) { await this.view.setScenario(id); }

  /** The on-screen pad calls these. */
  press(c) { this.held.add(c); this._touch(c); }
  release(c) { this.held.delete(c); }

  _key(e, down) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target?.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
    const c = KEYS[e.key.toLowerCase()];
    if (c === undefined) return;
    if (down) { this.held.add(c); this._touch(c); } else this.held.delete(c);
  }

  /** Any thruster input counts as taking over now, and a tap lasts at least TAP_MS. */
  _touch(c) {
    const now = performance.now();
    this.tapUntil[c] = now + TAP_MS;
    this.manualUntil = now + MANUAL_HOLD_MS;
  }

  _onFlow(flow, scn) {
    this.model = new BoatModel(flow);
    this.boat = new LiveBoat(this.model);
    this.boat.reset(scn.boat.start);
    this.tSched = 0; // sim seconds of the schedule played so far
    this.wake = [];
    this.mode = 'auto';
    this.manualUntil = 0;
  }

  _frame(ctx, dt) {
    if (!this.boat) return;
    dt = Math.min(dt, 0.12);
    const now = performance.now();
    if (this.held.size) this.manualUntil = now + MANUAL_HOLD_MS;
    const manual = now < this.manualUntil;
    if (manual) this.mode = 'manual';
    else if (this.mode === 'manual') this.mode = 'auto'; // the schedule resumes where it left off

    const x = this.boat.x;
    const simDt = dt * TIME_SCALE, steps = Math.max(1, Math.ceil(simDt / MAX_STEP)), h = simDt / steps;
    for (let i = 0; i < steps; i++) {
      if (manual) { for (let c = 0; c < NU; c++) this.u[c] = this.held.has(c) || now < this.tapUntil[c] ? 1 : 0; }
      else { this.u.set(this.scheduleAt(this.tSched)[1]); this.tSched += h; } // u(t): depends on time only
      this.boat.step(this.u, h);
    }
    // carried out of the river: start again
    if (this.scenario.sinks?.some((s) => s.sd(x[0], x[1]) < 60)) { this.boat.reset(this.scenario.boat.start); this.tSched = 0; this.wake = []; }

    const last = this.wake[this.wake.length - 1];
    if (!last || Math.hypot(last[0] - x[0], last[1] - x[1]) > 4) { this.wake.push([x[0], x[1]]); if (this.wake.length > 140) this.wake.shift(); }

    this.onStatus?.({ mode: this.mode, secondsLeft: Math.max(0, (this.manualUntil - now) / 1000), u: this.u, dir: this.scheduleAt(this.tSched)[0] });
    this._draw(ctx);
  }

  _draw(ctx) {
    const cam = this.view.camera, x = this.boat.x, p = cam.worldToScreen(x[0], x[1], [0, 0]);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // wake: a fading trail
    const n = this.wake.length, q = [0, 0];
    for (let i = 1; i < n; i++) {
      const a = cam.worldToScreen(this.wake[i - 1][0], this.wake[i - 1][1], [0, 0]), b = cam.worldToScreen(this.wake[i][0], this.wake[i][1], q);
      ctx.strokeStyle = `rgba(255,255,255,${0.75 * (i / n)})`;
      ctx.lineWidth = 1 + 3 * (i / n);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    // drift f(x) (the water's velocity) and input G(x)u (the thrust's velocity)
    const w = this.model.flow.velocity(x[0], x[1], [0, 0]);
    const acc = this.model.thrustVelocity(this.u);
    arrow(ctx, p[0], p[1], w[0] * 40, -w[1] * 40, COLORS.water, 3.5, 9);
    // thrust at the same scale as the drift (both are velocities)
    if (Math.hypot(acc[0], acc[1]) > 1e-3) arrow(ctx, p[0], p[1], acc[0] * 40, -acc[1] * 40, COLORS.thrust, 4.5, 10);
    boatGlyph(ctx, p[0], p[1], this._heading(this.boat.v), 1.7, true);
    ctx.restore();
  }

  /** The open-loop schedule at sim time t: [direction name, thruster settings]. */
  scheduleAt(t) { return SCHEDULE[Math.floor(t / (DIR_SECONDS * TIME_SCALE)) % SCHEDULE.length]; }

  _heading(v) {
    const sp = Math.hypot(v[0], v[1]);
    if (sp > 0.15) this._ang = Math.atan2(-v[1], v[0]);
    return this._ang ?? 0;
  }
}
