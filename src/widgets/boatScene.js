// BoatScene: a river + a boat + an editable open-loop schedule + (optionally) a live optimizer.
// Shared by the "schedule" and "optimize" slides.

import { BoatModel, NU } from '../control/boat.js';
import { evaluate, makeProblem, project, TrajectoryOptimizer } from '../control/optimizer.js';
import { Timeline } from '../control/timeline.js';
import { RiverView } from '../river/view.js';
import { getScenario } from '../river/scenarios.js';

export const COLORS = { thrust: '#d8572a', water: '#1f6fb2', ink: '#16283d', bad: '#c0392b', good: '#2e8b57' };
const N_INTERVALS = 60, SUBSTEPS = 5;

function arrow(ctx, x, y, dx, dy, color, width = 3, head = 8) {
  const len = Math.hypot(dx, dy);
  if (len < 3) return;
  const ux = dx / len, uy = dy / len, hx = x + dx, hy = y + dy;
  const draw = (w, col) => {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx - ux * head * 0.6, hy - uy * head * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx, hy);
    ctx.lineTo(hx - ux * head - uy * head * 0.55, hy - uy * head + ux * head * 0.55);
    ctx.lineTo(hx - ux * head + uy * head * 0.55, hy - uy * head - ux * head * 0.55);
    ctx.closePath(); ctx.fill();
  };
  draw(width + 3, 'rgba(255,255,255,0.9)');
  draw(width, color);
}

export class BoatScene {
  /**
   * @param {HTMLElement} stageEl map container
   * @param {HTMLElement} timelineWrap timeline container
   * @param {object} opts scenario, colormap, draggableTarget, showGhost, editable, onUpdate(scene)
   */
  constructor(stageEl, timelineWrap, opts = {}) {
    this.opts = { scenario: 'straight', colormap: 'none', draggableTarget: false, showGhost: true, editable: true, autoplayAfterSolve: true, ...opts };
    this.enabled = [true, true, true, true];
    this.U = new Float64Array(N_INTERVALS * NU);
    this.t = 0;
    this.playing = false;
    this.optimizer = null;
    this.eval = null;
    this.ghost = null;
    this.model = null;
    this.problem = null;
    this.view = new RiverView(stageEl, { scenario: this.opts.scenario, colormap: this.opts.colormap, legend: this.opts.colormap !== 'none' });
    this.view.onDraw = (ctx, v, now, dt) => this._frame(ctx, dt);
    this.view.onFlow = (flow, scn) => this._onFlow(flow, scn);
    this.timeline = new Timeline(timelineWrap, {
      N: N_INTERVALS, T: 1,
      getU: () => this.U,
      getEnabled: () => this.enabled,
      editable: this.opts.editable,
      onEdit: () => { this._stopSolver(); this._recompute(); this._notify(); },
      onSeek: (t) => { this.playing = false; this.t = t; this.timeline.setTime(t); this._notify(); },
    });
    this._dragging = false;
    this.view.addTool({
      pointerDown: (w, ev, view) => {
        if (!this.opts.draggableTarget || !this.problem) return false;
        const p = view.camera.worldToScreen(this.problem.target[0], this.problem.target[1]);
        const s = view.camera.worldToScreen(w[0], w[1]);
        if (Math.hypot(p[0] - s[0], p[1] - s[1]) > 22) return false;
        this._dragging = true;
        this._stopSolver();
        return true;
      },
      pointerMove: (w) => { if (this._dragging && this.view.flow.isWater(w[0], w[1], 10)) this.setTarget(w[0], w[1]); },
      pointerUp: () => { if (this._dragging) { this._dragging = false; this.startSolve(); } },
      hover: (w, view) => {
        if (!this.opts.draggableTarget || !this.problem) return null;
        const p = view.camera.worldToScreen(this.problem.target[0], this.problem.target[1]);
        const s = view.camera.worldToScreen(w[0], w[1]);
        return Math.hypot(p[0] - s[0], p[1] - s[1]) < 22 ? 'grab' : null;
      },
    });
  }

  get scenario() { return this.view.scenario; }
  get T() { return this.problem?.T ?? 1; }
  setActive(on) { this.view.setActive(on); if (!on) this.playing = false; }
  destroy() { this.timeline.destroy(); this.view.destroy(); }
  _notify() { this.opts.onUpdate?.(this); }

  async setScenario(id) {
    this._stopSolver();
    this.playing = false;
    await this.view.setScenario(id);
  }

  _onFlow(flow, scn) {
    this.model = new BoatModel(flow);
    this.problem = makeProblem(this.model, scn, { N: N_INTERVALS, sub: SUBSTEPS });
    this.problem.enabled = this.enabled;
    this.U = new Float64Array(N_INTERVALS * NU);
    this.t = 0;
    const zero = new Float64Array(N_INTERVALS * NU);
    this.ghost = evaluate(this.problem, zero, false).X;
    this.timeline.setHorizon(N_INTERVALS, this.problem.T);
    if (scn.boatView) this.view.camera.set(scn.boatView);
    this._recompute();
    this._notify();
  }

  _recompute() {
    if (!this.problem) return;
    project(this.U, this.problem);
    this.eval = evaluate(this.problem, this.U, false);
    this.timeline.draw();
  }

  // ---- editing ----
  setEnabled(c, on) {
    this.enabled[c] = on;
    this._stopSolver();
    this._recompute();
    this._notify();
  }

  clearSchedule() { this._stopSolver(); this.U.fill(0); this.t = 0; this.playing = false; this._recompute(); this.timeline.setTime(0); this._notify(); }

  /** Fill the schedule from a function (k, N) -> [uN, uE, uS, uW]. */
  fill(fn) {
    this._stopSolver();
    for (let k = 0; k < N_INTERVALS; k++) this.U.set(fn(k, N_INTERVALS), NU * k);
    this.t = 0;
    this._recompute();
    this._notify();
  }

  setTarget(x, y) {
    this.problem.target[0] = x; this.problem.target[1] = y;
    this._recompute();
    this._notify();
  }

  // ---- playback ----
  play() { if (this.t >= this.T - 1e-6) this.t = 0; this.playing = true; this._notify(); }
  pause() { this.playing = false; this._notify(); }
  restart() { this.t = 0; this.playing = true; this._notify(); }

  // ---- solving ----
  startSolve() {
    if (!this.problem) return;
    this.optimizer = new TrajectoryOptimizer(this.problem, this.U);
    this.playing = false;
    this._notify();
  }
  get solving() { return !!this.optimizer && !this.optimizer.done; }
  _stopSolver() { this.optimizer = null; }

  _stepSolver() {
    const opt = this.optimizer;
    if (!opt) return;
    const t0 = performance.now();
    while (!opt.done && performance.now() - t0 < 9) opt.run(2);
    this.U.set(opt.U);
    this._recompute();
    if (opt.done) {
      this.solved = { iter: opt.iter, J: opt.cost };
      this.optimizer = null;
      if (this.opts.autoplayAfterSolve) { this.t = 0; this.playing = true; }
    }
    this._notify();
  }

  stats() {
    const e = this.eval;
    if (!e) return null;
    let aground = 0;
    const flow = this.view.flow;
    for (let j = 1; j <= e.M; j++) if (flow.insideAt(e.X[4 * j], e.X[4 * j + 1]) < 0) aground++;
    return { t: this.t, T: this.T, miss: e.miss, effort: e.effort, J: e.J, grounded: aground / e.M, iter: this.optimizer?.iter ?? this.solved?.iter ?? 0, solving: this.solving };
  }

  // ---- per-frame: advance time/solver, then draw overlay ----
  _frame(ctx, dt) {
    if (!this.problem) return;
    if (this.optimizer) this._stepSolver();
    if (this.playing) {
      this.t = Math.min(this.t + dt * (this.T / 14), this.T);
      if (this.t >= this.T) this.playing = false;
      this.timeline.setTime(this.t);
      this._notify();
    }
    this._draw(ctx);
  }

  _pose(t) {
    const { X, M, h } = this.eval;
    const f = Math.min(Math.max(t / h, 0), M - 1e-9), j = Math.floor(f), a = f - j;
    const g = (i) => X[4 * j + i] * (1 - a) + X[4 * (j + 1) + i] * a;
    return { x: g(0), y: g(1), vx: g(2), vy: g(3), j };
  }

  _stroke(ctx, X, j0, j1, cam) {
    const p = [0, 0];
    ctx.beginPath();
    for (let j = j0; j <= j1; j++) {
      cam.worldToScreen(X[4 * j], X[4 * j + 1], p);
      j === j0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  }

  _draw(ctx) {
    const cam = this.view.camera, flow = this.view.flow, { problem } = this, e = this.eval;
    if (!e) return;
    const p = [0, 0];
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // ghost: where the water alone would take the boat
    if (this.opts.showGhost && this.ghost) {
      ctx.setLineDash([2, 7]);
      ctx.strokeStyle = 'rgba(22,40,61,0.55)';
      ctx.lineWidth = 2.5;
      this._stroke(ctx, this.ghost, 0, e.M, cam);
      ctx.setLineDash([]);
    }

    // planned path (full), then the traveled part on top
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    this._stroke(ctx, e.X, 0, e.M, cam);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(216,87,42,0.45)';
    this._stroke(ctx, e.X, 0, e.M, cam);

    const pose = this._pose(this.t);
    ctx.lineWidth = 4; ctx.strokeStyle = COLORS.thrust;
    this._stroke(ctx, e.X, 0, Math.max(pose.j, 1), cam);

    // aground segments in red
    ctx.strokeStyle = COLORS.bad; ctx.lineWidth = 5;
    for (let j = 1; j <= e.M; j++) {
      if (flow.insideAt(e.X[4 * j], e.X[4 * j + 1]) >= 0) continue;
      this._stroke(ctx, e.X, j - 1, j, cam);
    }

    // interval knots
    ctx.fillStyle = 'rgba(22,40,61,0.5)';
    for (let k = 0; k <= N_INTERVALS; k += 1) {
      const j = k * SUBSTEPS;
      cam.worldToScreen(e.X[4 * j], e.X[4 * j + 1], p);
      ctx.beginPath(); ctx.arc(p[0], p[1], 1.6, 0, 6.283); ctx.fill();
    }

    // start and target markers
    this._marker(ctx, cam, problem.x0[0], problem.x0[1], 'start', false);
    this._marker(ctx, cam, problem.target[0], problem.target[1], 'target', this.opts.draggableTarget);

    // boat and vectors
    cam.worldToScreen(pose.x, pose.y, p);
    const w = flow.velocity(pose.x, pose.y, [0, 0]);
    const k = Math.min(Math.floor(this.t / (this.T / N_INTERVALS)), N_INTERVALS - 1);
    const acc = this.model.thrustAccel(this.U.subarray(NU * k, NU * k + NU));
    const vs = 30, as = 70; // px per (m/s), px per (m/s^2)
    arrow(ctx, p[0], p[1], w[0] * vs, -w[1] * vs, COLORS.water, 3);
    arrow(ctx, p[0], p[1], acc[0] * as, -acc[1] * as, COLORS.thrust, 4, 9);
    this._boat(ctx, p[0], p[1], Math.atan2(-pose.vy, pose.vx), Math.hypot(pose.vx, pose.vy));
    arrow(ctx, p[0], p[1], pose.vx * vs, -pose.vy * vs, COLORS.ink, 2.2, 7);
    ctx.restore();
  }

  _marker(ctx, cam, x, y, label, draggable) {
    const p = cam.worldToScreen(x, y, [0, 0]);
    ctx.save();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, 6.283); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = label === 'target' ? COLORS.thrust : COLORS.ink;
    ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, 6.283); ctx.stroke();
    if (label === 'target') { ctx.fillStyle = COLORS.thrust; ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 6.283); ctx.fill(); }
    if (draggable) { ctx.setLineDash([3, 3]); ctx.strokeStyle = COLORS.thrust; ctx.beginPath(); ctx.arc(p[0], p[1], 17, 0, 6.283); ctx.stroke(); }
    ctx.font = '700 12px "Source Sans Pro", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.fillStyle = COLORS.ink;
    ctx.setLineDash([]);
    ctx.strokeText(label, p[0], p[1] - 24); ctx.fillText(label, p[0], p[1] - 24);
    ctx.restore();
  }

  _boat(ctx, x, y, ang, speed) {
    ctx.save();
    ctx.translate(x, y);
    if (speed > 0.15) this._lastAng = ang; // `ang` is already a screen-space angle (y down)
    ctx.rotate(this._lastAng ?? 0);
    ctx.beginPath();
    ctx.moveTo(13, 0); ctx.quadraticCurveTo(5, 6.5, -10, 6); ctx.lineTo(-10, -6); ctx.quadraticCurveTo(5, -6.5, 13, 0); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(20,40,70,0.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    ctx.fill(); ctx.shadowColor = 'transparent'; ctx.stroke();
    ctx.restore();
  }
}
