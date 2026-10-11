// Slide: closed- versus open-loop. Two boats leave together for the same target.
//   open loop   follows a thrust schedule computed in advance (the optimizer's plan)
//   closed loop measures its state and reacts (the autopilot, with the target as its fixed destination)
// Partway through, a gust pushes both boats sideways. The open-loop boat keeps executing its plan and misses;
// the closed-loop boat corrects. Then the run repeats.

import { Autopilot } from '../control/autopilot.js';
import { BoatModel, NU } from '../control/boat.js';
import { LiveBoat } from '../control/liveBoat.js';
import { evaluate, makeProblem, TrajectoryOptimizer } from '../control/optimizer.js';
import { RiverView } from '../river/view.js';
import { arrow, boatGlyph, COLORS } from './draw.js';
import { createMapControls } from './mapControls.js';
import { h } from './ui.js';

const TIME_SCALE = 35;        // sim seconds per real second
const GUST = { at: 0.3, duration: 40, accel: 0.55 }; // fraction of horizon, sim seconds, m/s^2
const LINGER = 0.3;           // extra fraction of the horizon to watch after the plan ends

export function create(el) {
  el.classList.add('map-widget', 'gallery');
  const stage = h('div', { class: 'stage' });
  const view = new RiverView(stage, { scenario: 'meander' });
  const gustBtn = h('button', { type: 'button', class: 'map-action' }, 'Gust');
  const againBtn = h('button', { type: 'button', class: 'map-action' }, 'Restart');
  stage.append(h('div', { class: 'map-actions' }, gustBtn, againBtn));
  view.setLegendItems([
    { color: COLORS.open, text: 'open loop' },
    { color: COLORS.closed, text: 'closed loop' },
  ]);
  const controls = createMapControls(view);
  el.append(stage, controls.el);

  const st = { ready: false };
  let token = 0;

  view.onFlow = ((prev) => (flow, scn) => { prev?.(flow, scn); plan(flow, scn); })(view.onFlow);

  // Plan the open-loop schedule in short chunks so the page stays responsive.
  function plan(flow, scn) {
    const my = ++token;
    st.ready = false;
    st.model = new BoatModel(flow);
    st.problem = makeProblem(st.model, scn);
    const opt = new TrajectoryOptimizer(st.problem);
    const step = () => {
      if (my !== token) return;
      const t0 = performance.now();
      while (!opt.done && performance.now() - t0 < 14) opt.run(2);
      if (!opt.done) { setTimeout(step, 0); return; }
      st.U = Float64Array.from(opt.U);
      st.planned = evaluate(st.problem, st.U).X;
      st.M = st.planned.length / 4 - 1;
      reset();
      st.ready = true;
    };
    step();
  }

  function reset() {
    const { model, problem } = st, scn = view.scenario;
    st.t = 0; st.acc = 0; st.h = problem.T / (problem.N * problem.sub);
    st.ol = new LiveBoat(model); st.ol.reset(scn.boat.start);
    st.cl = new LiveBoat(model); st.cl.reset(scn.boat.start);
    st.pilot = new Autopilot(model.flow, scn, model, { cruise: 3.2 });
    st.pilot.goTo(problem.target, scn.boat.start);
    st.gust = null; st.autoGusted = false;
    st.trails = [[], []];
  }

  function startGust() {
    if (!st.ready) return;
    // push sideways (perpendicular to the local current), toward the side with more water
    const x = st.ol.x, f = st.model.flow, w = f.velocity(x[0], x[1], [0, 0]);
    let nx = -w[1], ny = w[0];
    const m = Math.hypot(nx, ny) || 1; nx /= m; ny /= m;
    if (f.insideAt(x[0] - 40 * nx, x[1] - 40 * ny) > f.insideAt(x[0] + 40 * nx, x[1] + 40 * ny)) { nx = -nx; ny = -ny; }
    st.gust = { left: GUST.duration, ax: GUST.accel * nx, ay: GUST.accel * ny };
  }
  gustBtn.addEventListener('click', startGust);
  againBtn.addEventListener('click', () => { if (st.ready) reset(); });

  const u = new Float64Array(NU);
  function advance(dt) {
    const { problem } = st, T = problem.T, dtU = T / problem.N;
    st.acc += Math.min(dt, 0.12) * TIME_SCALE;
    while (st.acc >= st.h) {
      st.acc -= st.h;
      if (!st.autoGusted && st.t >= GUST.at * T) { st.autoGusted = true; startGust(); }
      const k = Math.floor(st.t / dtU);
      for (let c = 0; c < NU; c++) u[c] = k < problem.N ? st.U[NU * k + c] : 0;
      st.ol.step(u, st.h);
      st.cl.step(st.pilot.control(st.cl.x, st.h), st.h);
      if (st.gust) {
        for (const b of [st.ol, st.cl]) { b.x[2] += st.gust.ax * st.h; b.x[3] += st.gust.ay * st.h; b.constrain(); }
        st.gust.left -= st.h;
        if (st.gust.left <= 0) st.gust = null;
      }
      st.t += st.h;
      [st.ol, st.cl].forEach((b, i) => {
        const tr = st.trails[i], last = tr[tr.length - 1];
        if (!last || Math.hypot(last[0] - b.x[0], last[1] - b.x[1]) > 4) tr.push([b.x[0], b.x[1]]);
      });
    }
    if (st.t > T * (1 + LINGER)) reset();
  }

  function line(ctx, pts, getXY, color, width, dash = []) {
    const cam = view.camera, p = [0, 0];
    ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach((q, i) => { const [x, y] = getXY(q, i); cam.worldToScreen(x, y, p); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
    ctx.stroke(); ctx.setLineDash([]);
  }

  view.onDraw = (ctx, v, now, dt) => {
    if (!st.ready) return;
    advance(dt);
    const cam = view.camera, P = st.planned;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // the open-loop plan, as computed in advance
    const planIdx = Array.from({ length: st.M + 1 }, (_, j) => j);
    line(ctx, planIdx, (j) => [P[4 * j], P[4 * j + 1]], 'rgba(255,255,255,0.9)', 5);
    line(ctx, planIdx, (j) => [P[4 * j], P[4 * j + 1]], COLORS.open, 2, [3, 6]);

    // trails
    st.trails.forEach((tr, i) => {
      if (tr.length < 2) return;
      line(ctx, tr, (q) => q, 'rgba(255,255,255,0.85)', 6);
      line(ctx, tr, (q) => q, i ? COLORS.closed : COLORS.open, 3);
    });

    // target
    const tg = cam.worldToScreen(st.problem.target[0], st.problem.target[1], [0, 0]);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(tg[0], tg[1], 12, 0, 6.283); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = COLORS.ink; ctx.beginPath(); ctx.arc(tg[0], tg[1], 12, 0, 6.283); ctx.stroke();
    ctx.fillStyle = COLORS.ink; ctx.beginPath(); ctx.arc(tg[0], tg[1], 3, 0, 6.283); ctx.fill();

    // boats (and the gust pushing them)
    [st.ol, st.cl].forEach((b, i) => {
      const p = cam.worldToScreen(b.x[0], b.x[1], [0, 0]);
      if (st.gust) arrow(ctx, p[0], p[1], st.gust.ax * 110, -st.gust.ay * 110, 'rgba(22,40,61,0.55)', 5, 12);
      const sp = Math.hypot(b.x[2], b.x[3]);
      b._ang = sp > 0.15 ? Math.atan2(-b.x[3], b.x[2]) : b._ang ?? 0;
      boatGlyph(ctx, p[0], p[1], b._ang, 1.5, true, i ? COLORS.closed : COLORS.open);
    });
    if (st.gust) {
      const p = cam.worldToScreen(st.ol.x[0], st.ol.x[1], [0, 0]);
      ctx.font = '700 14px "Source Sans Pro", system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.fillStyle = COLORS.ink;
      const lx = p[0] + st.gust.ax * 130, ly = p[1] - st.gust.ay * 130 - 6;
      ctx.strokeText('gust', lx, ly); ctx.fillText('gust', lx, ly);
    }
    ctx.restore();
  };

  if (import.meta.env?.DEV) window.__loops = { st, view }; // dev-only debugging hook
  return { setActive: (on) => view.setActive(on), destroy: () => { token++; view.destroy(); } };
}
