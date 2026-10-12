// Slide: optimal control with a fitted drift. Same river and data as "Unknown drift?".
// For the selected drift model we solve the trajectory optimization problem
//   min ||x(T) - x_B||  s.t.  x' = f_hat(x) + G u,  x(0) = first sample of basin A's time series,  0 <= u <= 1
// then run the *same* schedule u on the actual drift. The planned path (what the model predicts) is dashed;
// the actual outcome is solid. Planning with the actual drift is the baseline.
import katex from 'katex';
import { BoatModel, NU } from '../control/boat.js';
import { makeDriftData } from '../control/driftFits.js';
import { LiveBoat } from '../control/liveBoat.js';
import { evaluate, makeProblem, TrajectoryOptimizer } from '../control/optimizer.js';
import { RiverView } from '../river/view.js';
import { boatGlyph, COLORS } from './draw.js';
import { h } from './ui.js';

const HORIZON = 500;          // seconds
const PLAY_SECONDS = 10;      // real seconds to play one run
const HOLD_SECONDS = 2.5;     // pause at the end before replaying

const MODES = {
  fit1: { button: 'Plan with fit 1', tex: String.raw`\dot{x} = \hat{f}_1(x) + G\,u`, note: 'Planned with fit 1 (local average), run on the actual drift' },
  fit2: { button: 'Plan with fit 2', tex: String.raw`\dot{x} = \hat{f}_2(x) + G\,u`, note: 'Planned with fit 2 (linear), run on the actual drift' },
  fit3: { button: 'Plan with fit 3', tex: String.raw`\dot{x} = \hat{f}_3(x) + G\,u`, note: 'Planned with fit 3 (quadratic), run on the actual drift' },
  actual: { button: 'Plan with actual drift', tex: String.raw`\dot{x} = f(x) + G\,u`, note: 'Planned with the actual drift (the baseline)' },
};

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
  stage.append(label, result, h('div', { class: 'map-actions' }, ...buttons));
  el.append(stage);

  let data = null, actual = null, mode = 'fit1', token = 0, t0 = performance.now();
  const plans = {}; // mode -> { planned: Float64Array X, real: [[x, y]...], plannedMiss, realMiss } | 'pending'

  function setMode(next) {
    mode = next;
    const m = MODES[mode];
    label.innerHTML = katex.renderToString(m.tex, { throwOnError: false }) + `<div class="map-math-note">${m.note}</div>`;
    buttons.forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    if (!data) return;
    view.showField(mode === 'actual' ? actual : data.fits[mode]);
    t0 = performance.now();
    showResult();
  }

  function showResult() {
    const p = plans[mode];
    result.textContent = !p || p === 'pending' ? 'Planning…' : `Planned miss ${p.plannedMiss.toFixed(0)} m  ·  actual miss ${p.realMiss.toFixed(0)} m`;
    result.classList.toggle('bad', !!p && p !== 'pending' && p.realMiss > 25);
  }

  // Solve one plan in short chunks (keeps the page responsive), then run it on the actual drift.
  function plan(key, my, done) {
    const field = key === 'actual' ? actual : data.fits[key];
    const start = data.series[0], target = data.single;
    const scn = { ...view.scenario, boat: { start, target, horizon: HORIZON } };
    const problem = makeProblem(new BoatModel(field), scn);
    problem.x0 = Float64Array.of(start[0], start[1], 0, 0);
    const opt = new TrajectoryOptimizer(problem);
    plans[key] = 'pending';
    const step = () => {
      if (my !== token) return;
      const ts = performance.now();
      while (!opt.done && opt.iter < 4000 && performance.now() - ts < 14) opt.run(2);
      if (!opt.done && opt.iter < 4000) { setTimeout(step, 0); return; }
      const planned = evaluate(problem, opt.U).X;
      const boat = new LiveBoat(new BoatModel(actual)), u = new Float64Array(NU);
      boat.x.set([start[0], start[1], 0, 0]);
      const M = problem.N * problem.sub, hh = HORIZON / M, real = [[start[0], start[1]]];
      for (let j = 0; j < M; j++) {
        const k = Math.floor(j / problem.sub);
        for (let c = 0; c < NU; c++) u[c] = opt.U[NU * k + c];
        boat.step(u, hh);
        real.push([boat.x[0], boat.x[1]]);
      }
      plans[key] = {
        planned, real,
        plannedMiss: opt.last.miss,
        realMiss: Math.hypot(boat.x[0] - target[0], boat.x[1] - target[1]),
      };
      if (key === mode) { t0 = performance.now(); showResult(); }
      done();
    };
    step();
  }

  view.onFlow = ((prev) => (flow, scn) => {
    prev?.(flow, scn);
    actual = flow;
    data = makeDriftData(flow, scn);
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

    // the data, faintly: basin A's time series and basin B's single sample (the target)
    for (const s of data.series) {
      cam.worldToScreen(s[0], s[1], q);
      ctx.fillStyle = 'rgba(22,40,61,0.35)'; ctx.beginPath(); ctx.arc(q[0], q[1], 3.5, 0, 6.283); ctx.fill();
    }
    const p = plans[mode];
    if (p && p !== 'pending') {
      const planned = Array.from({ length: p.planned.length / 4 }, (_, j) => [p.planned[4 * j], p.planned[4 * j + 1]]);
      path(ctx, planned, 'rgba(255,255,255,0.9)', 5, []);
      path(ctx, planned, COLORS.thrust, 2.5, [5, 6]);
      // the actual outcome, drawn up to the playhead
      const f = Math.min(((performance.now() - t0) / 1000) / PLAY_SECONDS, 1);
      if ((performance.now() - t0) / 1000 > PLAY_SECONDS + HOLD_SECONDS) t0 = performance.now();
      const n = Math.max(2, Math.round(f * (p.real.length - 1)) + 1), shown = p.real.slice(0, n);
      path(ctx, shown, 'rgba(255,255,255,0.9)', 6, []);
      path(ctx, shown, COLORS.ink, 3, []);
      // boats: the plan's prediction (orange) and reality (white)
      const jp = Math.min(Math.round(f * (planned.length - 1)), planned.length - 1);
      const head = (pts, j) => { const a = pts[Math.max(0, j - 1)], b = pts[j]; return Math.atan2(-(b[1] - a[1]), b[0] - a[0]); };
      cam.worldToScreen(planned[jp][0], planned[jp][1], q);
      boatGlyph(ctx, q[0], q[1], head(planned, jp), 1.2, false, COLORS.thrust);
      cam.worldToScreen(shown[n - 1][0], shown[n - 1][1], q);
      boatGlyph(ctx, q[0], q[1], head(shown, n - 1), 1.5, true, '#ffffff');
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
    caption('basin A: start', data.basinA.x + data.basinA.R + 12, data.basinA.y);
    caption('basin B: target', data.basinB.x + data.basinB.R + 12, data.basinB.y);
    ctx.restore();
  };

  if (import.meta.env?.DEV) window.__optimal = { view, plans, setMode }; // dev-only debugging hook
  return {
    setActive(on) { view.setActive(on); if (on) t0 = performance.now(); },
    destroy: () => { token++; view.destroy(); },
  };
}
