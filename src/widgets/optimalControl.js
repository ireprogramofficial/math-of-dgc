// Slide: optimal control with a fitted drift. Same river and data as "Unknown drift?".
// For the selected drift model we solve the trajectory optimization problem
//   min ||x(T) - x_target||  s.t.  x' = f_hat(x) + G u,  x(0) = first sample of the initial basin's time series,  0 <= u <= 1
// then run the *same* schedule u on the actual drift. The planned path (what the model predicts) is dashed;
// the actual outcome is solid, played after the prediction completes. Planning with the actual drift is the baseline.
// Fit 4 (DGC-style, rank-one time-varying) is planned in its own first-order model by bounded nonnegative least
// squares over K steps of the data's sampling interval, then run on the actual boat the same way.
import katex from 'katex';
import { BoatModel, NU, NX } from '../control/boat.js';
import { FIT_METHODS, ltvFields, makeDriftData, SERIES } from '../control/driftFits.js';
import { planLTV, thrustMatrix } from '../control/rankOneLTV.js';
import { LiveBoat } from '../control/liveBoat.js';
import { evaluate, makeProblem, TrajectoryOptimizer } from '../control/optimizer.js';
import { RiverView } from '../river/view.js';
import { boatGlyph, COLORS } from './draw.js';
import { h } from './ui.js';

const HORIZON = 500;          // seconds
const PLAY_SECONDS = 7;       // real seconds to play each path
const GAP_SECONDS = 1.5;      // pause between the predicted path and the real outcome
const HOLD_SECONDS = 3;       // pause at the end before replaying

const MODES = {
  fit1: { button: 'Fit drift 1', tex: String.raw`\dot{x} = \hat{f}_1(x) + G\,u`, note: 'Planned with fit 1, run on the actual drift' },
  fit2: { button: 'Fit drift 2', tex: String.raw`\dot{x} = \hat{f}_2(x) + G\,u`, note: 'Planned with fit 2, run on the actual drift' },
  fit3: { button: 'Fit drift 3', tex: String.raw`\dot{x} = \hat{f}_3(x) + G\,u`, note: 'Planned with fit 3, run on the actual drift' },
  fit4: { button: 'Fit drift 4', tex: String.raw`x[k{+}1] = A[k]\,x[k] + B\,u[k]`, note: 'Planned with fit 4 (bounded NNLS), run on the actual drift' },
  actual: { button: 'Actual drift', tex: String.raw`\dot{x} = f(x) + G\,u`, note: 'Planned with the actual drift (the baseline)' },
};
const LTV_STEPS = Math.round(HORIZON / SERIES.every); // fit 4 plans over whole sampling intervals (18 x 28 s = 504 s)

export function create(el) {
  el.classList.add('map-widget', 'gallery');
  const stage = h('div', { class: 'stage' });
  const view = new RiverView(stage, { scenario: 'triangle', interactive: true, labels: false });
  view.setLegendItems([
    { color: COLORS.thrust, text: 'planned (model)', dash: true },
    { color: COLORS.ink, text: 'actual outcome' },
  ]);
  const label = h('div', { class: 'map-math' });
  const result = h('div', { class: 'map-hint map-result' });
  const buttons = Object.entries(MODES).map(([key, m]) => {
    const b = h('button', { type: 'button', class: 'map-action', 'data-mode': key }, m.button);
    b.addEventListener('click', () => setMode(key));
    return b;
  });
  stage.append(label, result, h('div', { class: 'map-actions' }, h('span', { class: 'map-actions-label' }, 'Plan with'), ...buttons));
  el.append(stage);

  let data = null, actual = null, mode = 'fit1', token = 0, t0 = performance.now();
  let stepFields = null, step = -1; // fit 4's drift changes every step
  const plans = {}; // mode -> { planned: Float64Array X, real: [[x, y]...], plannedMiss, realMiss } | 'pending'

  function setMode(next) {
    mode = next;
    const m = MODES[mode];
    label.innerHTML = katex.renderToString(m.tex, { throwOnError: false })
      + (FIT_METHODS[mode] ? `<div class="map-math-method">Method: <b>${FIT_METHODS[mode]}</b></div>` : '')
      + `<div class="map-math-note">${m.note}</div>`;
    buttons.forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    if (!data) return;
    step = -1;
    if (mode === 'fit4') { stepFields ??= ltvFields(actual, data.ltv); showStep(0); }
    else view.showField(mode === 'actual' ? actual : data.fits[mode]);
    t0 = performance.now();
    showResult();
  }

  function showStep(k) {
    if (k === step) return;
    step = k;
    view.showField(stepFields[k], { streamlines: false, keepParticles: k > 0 });
  }

  function showResult() {
    const p = plans[mode];
    // the actual miss is only revealed once the real outcome plays (see onDraw)
    result.textContent = !p || p === 'pending' ? 'Planning…' : `Planned miss ${p.plannedMiss.toFixed(0)} m`;
    result.classList.remove('bad');
  }

  // Solve one plan in short chunks (keeps the page responsive), then run it on the actual drift.
  function plan(key, my, done) {
    if (key === 'fit4') { planFit4(); setTimeout(done, 0); return; }
    const field = key === 'actual' ? actual : data.fits[key];
    const start = data.series[0], target = data.single;
    const scn = { ...view.scenario, boat: { start, target, horizon: HORIZON } };
    const problem = makeProblem(new BoatModel(field), scn);
    const opt = new TrajectoryOptimizer(problem);
    plans[key] = 'pending';
    const step = () => {
      if (my !== token) return;
      const ts = performance.now();
      while (!opt.done && opt.iter < 4000 && performance.now() - ts < 14) opt.run(2);
      if (!opt.done && opt.iter < 4000) { setTimeout(step, 0); return; }
      const planned = evaluate(problem, opt.U).X;
      const boat = new LiveBoat(new BoatModel(actual)), u = new Float64Array(NU);
      boat.x.set(start);
      const M = problem.N * problem.sub, hh = HORIZON / M, real = [[start[0], start[1]]];
      for (let j = 0; j < M; j++) {
        const k = Math.floor(j / problem.sub);
        for (let c = 0; c < NU; c++) u[c] = opt.U[NU * k + c];
        boat.step(u, hh);
        real.push([boat.x[0], boat.x[1]]);
      }
      plans[key] = {
        planned: Array.from({ length: planned.length / NX }, (_, j) => [planned[NX * j], planned[NX * j + 1]]), real,
        plannedMiss: opt.last.miss,
        realMiss: Math.hypot(boat.x[0] - target[0], boat.x[1] - target[1]),
      };
      if (key === mode) { t0 = performance.now(); showResult(); }
      done();
    };
    step();
  }

  // Fit 4: plan in the rank-one LTV model (bounded NNLS), then hold each step's thrust for one sampling interval on the boat.
  function planFit4() {
    const start = data.series[0], target = data.single, dt = SERIES.every;
    const res = planLTV(data.ltv, thrustMatrix(new BoatModel(actual), dt), start, target, LTV_STEPS);
    const boat = new LiveBoat(new BoatModel(actual)), u = new Float64Array(NU), hh = 0.5, sub = Math.round(dt / hh);
    boat.x.set(start);
    const real = [[start[0], start[1]]];
    for (let k = 0; k < LTV_STEPS; k++) {
      for (let c = 0; c < NU; c++) u[c] = res.U[NU * k + c];
      for (let j = 0; j < sub; j++) { boat.step(u, hh); real.push([boat.x[0], boat.x[1]]); }
    }
    plans.fit4 = { planned: res.path, real, plannedMiss: res.plannedMiss, realMiss: Math.hypot(boat.x[0] - target[0], boat.x[1] - target[1]) };
    if (mode === 'fit4') { t0 = performance.now(); showResult(); }
  }

  view.onFlow = ((prev) => (flow, scn) => {
    prev?.(flow, scn);
    actual = flow;
    data = makeDriftData(flow, scn);
    stepFields = null;
    const my = ++token;
    // plan the selected mode first, then the rest in the background
    const order = [mode, ...Object.keys(MODES).filter((k) => k !== mode)];
    const next = () => { const k = order.shift(); if (k) plan(k, my, next); };
    next();
    setMode(mode);
  })(view.onFlow);
  setMode(mode);

  const path = (ctx, pts, color, width, dash) => {
    const cam = view.camera, q = [0, 0];
    ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    pts.forEach((p, i) => { cam.worldToScreen(p[0], p[1], q); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
    ctx.stroke(); ctx.setLineDash([]);
  };

  view.onDraw = (ctx) => {
    if (!data) return;
    const cam = view.camera, q = [0, 0];
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // the data, faintly: the initial basin's time series and the target basin's single sample
    for (const s of data.series) {
      cam.worldToScreen(s[0], s[1], q);
      ctx.fillStyle = 'rgba(22,40,61,0.35)'; ctx.beginPath(); ctx.arc(q[0], q[1], 3.5, 0, 6.283); ctx.fill();
    }
    const p = plans[mode];
    if (p && p !== 'pending') {
      const planned = p.planned;
      // Sequence: the model's prediction plays to completion, a pause, then the real outcome plays; hold; repeat.
      let t = (performance.now() - t0) / 1000;
      if (t > 2 * PLAY_SECONDS + GAP_SECONDS + HOLD_SECONDS) { t0 = performance.now(); t = 0; }
      const fPlan = Math.min(t / PLAY_SECONDS, 1);
      const fReal = Math.min(Math.max((t - PLAY_SECONDS - GAP_SECONDS) / PLAY_SECONDS, 0), 1);
      // fit 4: show the drift of the step being played (prediction first, then the real run)
      if (mode === 'fit4' && stepFields) showStep(Math.min(LTV_STEPS - 1, Math.floor((fReal > 0 ? fReal : fPlan) * LTV_STEPS)));
      const head = (pts, j) => { const a = pts[Math.max(0, j - 1)], b = pts[j]; return Math.atan2(-(b[1] - a[1]), b[0] - a[0]); };
      const upTo = (pts, f) => pts.slice(0, Math.max(2, Math.round(f * (pts.length - 1)) + 1));

      const shownPlan = upTo(planned, fPlan);
      path(ctx, shownPlan, 'rgba(255,255,255,0.9)', 5, []);
      path(ctx, shownPlan, COLORS.thrust, 2.5, [5, 6]);
      cam.worldToScreen(shownPlan[shownPlan.length - 1][0], shownPlan[shownPlan.length - 1][1], q);
      boatGlyph(ctx, q[0], q[1], head(shownPlan, shownPlan.length - 1), 1.3, fReal === 0, COLORS.thrust);

      if (fReal > 0) {
        const shownReal = upTo(p.real, fReal);
        path(ctx, shownReal, 'rgba(255,255,255,0.9)', 6, []);
        path(ctx, shownReal, COLORS.ink, 3, []);
        cam.worldToScreen(shownReal[shownReal.length - 1][0], shownReal[shownReal.length - 1][1], q);
        boatGlyph(ctx, q[0], q[1], head(shownReal, shownReal.length - 1), 1.5, true, '#ffffff');
      }
      result.textContent = fReal === 0
        ? `Planned miss ${p.plannedMiss.toFixed(0)} m`
        : `Planned miss ${p.plannedMiss.toFixed(0)} m  ·  actual miss ${p.realMiss.toFixed(0)} m`;
      result.classList.toggle('bad', fReal > 0 && p.realMiss > 25);
    }
    // start and target
    cam.worldToScreen(data.series[0][0], data.series[0][1], q);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(q[0], q[1], 6, 0, 6.283); ctx.fill(); ctx.stroke();
    cam.worldToScreen(data.single[0], data.single[1], q);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(q[0], q[1], 12, 0, 6.283); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = COLORS.ink; ctx.beginPath(); ctx.arc(q[0], q[1], 12, 0, 6.283); ctx.stroke();
    ctx.fillStyle = COLORS.ink; ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, 6.283); ctx.fill();
    // captions
    const caption = (text, x, y) => {
      cam.worldToScreen(x, y, q);
      ctx.font = '600 13px "Source Sans Pro", system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.fillStyle = COLORS.ink;
      ctx.strokeText(text, q[0], q[1]); ctx.fillText(text, q[0], q[1]);
    };
    caption('initial basin: start', data.basinInitial.x + data.basinInitial.R + 12, data.basinInitial.y);
    caption('target basin', data.basinTarget.x + data.basinTarget.R + 12, data.basinTarget.y);
    ctx.restore();
  };

  if (import.meta.env?.DEV) window.__optimal = { view, plans, setMode, seek: (sec) => { t0 = performance.now() - sec * 1000; view.onDraw(view.ctx); } }; // dev-only debugging hook
  return {
    setActive(on) { view.setActive(on); if (on) t0 = performance.now(); },
    destroy: () => { token++; view.destroy(); },
  };
}
